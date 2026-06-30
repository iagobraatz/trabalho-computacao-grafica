/**
 * loader.js — Carregamento e cache de modelos OBJ para WebGL2
 *
 * Responsabilidades:
 *  1. Fazer fetch dos arquivos .obj em models/
 *  2. Parsear o formato OBJ (v, vt, vn, f)
 *  3. Expandir índices compostos (v/vt/vn) → arrays planos
 *  4. Criar VAO + buffers na GPU (uma única vez por modelo)
 *  5. Calcular bounding box para posicionamento de câmera
 *
 * Cache: uma vez que o modelo está na GPU, chamadas subsequentes
 * retornam a referência ao mesmo VAO — nunca duplica memória.
 */

// ─────────────────────────────────────────────────────────────
// LISTA DE MODELOS DISPONÍVEIS
// ─────────────────────────────────────────────────────────────

export const MODEL_LIST = [
  // Infraestrutura
  { name: 'base',                   label: 'Base Tile'         },
  { name: 'road_straight',          label: 'Rua Reta'          },
  { name: 'road_corner',            label: 'Rua Esquina'       },
  { name: 'road_corner_curved',     label: 'Rua Curva'         },
  { name: 'road_tsplit',            label: 'Rua T'             },
  { name: 'road_junction',          label: 'Cruzamento'        },
  { name: 'road_straight_crossing', label: 'Faixa Pedestre'    },
  // Edifícios
  { name: 'building_A',             label: 'Edifício A'        },
  { name: 'building_B',             label: 'Edifício B'        },
  { name: 'building_C',             label: 'Edifício C'        },
  { name: 'building_D',             label: 'Edifício D'        },
  { name: 'building_E',             label: 'Edifício E'        },
  { name: 'building_F',             label: 'Edifício F'        },
  { name: 'building_G',             label: 'Edifício G'        },
  { name: 'building_H',             label: 'Edifício H'        },
  // Veículos
  { name: 'car_sedan',              label: 'Carro Sedan'       },
  { name: 'car_police',             label: 'Carro Polícia'     },
  { name: 'car_hatchback',          label: 'Hatchback'         },
  { name: 'car_taxi',               label: 'Taxi'              },
  { name: 'car_stationwagon',       label: 'Perua'             },
  // Rodas (úteis para hierarquia)
  { name: 'car_sedan_wheel_front_left',  label: 'Roda Frente E' },
  { name: 'car_sedan_wheel_front_right', label: 'Roda Frente D' },
  { name: 'car_sedan_wheel_rear_left',   label: 'Roda Trás E'   },
  { name: 'car_sedan_wheel_rear_right',  label: 'Roda Trás D'   },
  // Props urbanos
  { name: 'bush',                   label: 'Arbusto'           },
  { name: 'bench',                  label: 'Banco'             },
  { name: 'box_A',                  label: 'Caixa A'           },
  { name: 'box_B',                  label: 'Caixa B'           },
  { name: 'streetlight',            label: 'Poste'             },
  { name: 'trafficlight_A',         label: 'Semáforo A'        },
  { name: 'trafficlight_B',         label: 'Semáforo B'        },
  { name: 'trafficlight_C',         label: 'Semáforo C'        },
  { name: 'watertower',             label: 'Torre de Água'     },
  { name: 'dumpster',               label: 'Lixeira'           },
  { name: 'firehydrant',            label: 'Hidrante'          },
  { name: 'trash_A',                label: 'Lixo A'            },
  { name: 'trash_B',                label: 'Lixo B'            },
];


// ─────────────────────────────────────────────────────────────
// PARSER OBJ
// ─────────────────────────────────────────────────────────────

/**
 * Converte índice OBJ (1-based, pode ser negativo) para 0-based.
 * Índices negativos em OBJ significam "a partir do fim do array".
 */
function resolveIdx(str, length) {
  const n = parseInt(str, 10);
  if (isNaN(n)) return 0;
  return n < 0 ? length + n : n - 1;
}

/**
 * Parseia o texto de um arquivo .obj.
 *
 * Processo de expansão de índices:
 *   OBJ usa índices separados: f 1/1/1 2/2/2 3/3/3
 *   WebGL usa um único índice por vértice.
 *   Solução: cada combinação única (posIdx/uvIdx/normIdx) vira
 *   um vértice único. Um Map rastreia combinações já criadas.
 *
 * @param {string} text — conteúdo do arquivo .obj
 * @returns {{ positions, texcoords, normals, indices }}
 */
function parseOBJ(text) {
  // Arrays de origem (indexados separadamente, como no arquivo)
  const srcPos  = [];   // [ [x,y,z], ... ]
  const srcUV   = [];   // [ [u,v], ... ]
  const srcNorm = [];   // [ [x,y,z], ... ]

  // Arrays de saída (expandidos, um vértice por linha)
  const outPos  = [];
  const outUV   = [];
  const outNorm = [];
  const outIdx  = [];

  // Map de chave "pi/ti/ni" → índice no array de saída
  const vertMap = new Map();
  let nextVert  = 0;

  /**
   * Adiciona ou reutiliza um vértice pela combinação de índices.
   * Retorna o índice no array de saída.
   */
  function getVertex(pi, ti, ni) {
    const key = `${pi}|${ti}|${ni}`;
    if (vertMap.has(key)) return vertMap.get(key);

    // Valores padrão para caso o índice esteja fora do range
    const p = srcPos[pi]  ?? [0, 0, 0];
    const t = srcUV[ti]   ?? [0, 0];
    const n = srcNorm[ni] ?? [0, 1, 0];  // normal padrão: aponta para cima

    outPos.push(p[0], p[1], p[2]);
    outUV.push(t[0], t[1]);
    outNorm.push(n[0], n[1], n[2]);

    vertMap.set(key, nextVert);
    return nextVert++;
  }

  // Processa linha por linha
  const lines = text.split('\n');
  for (const rawLine of lines) {
    const line  = rawLine.trim();
    if (!line || line.startsWith('#')) continue;  // pula vazios e comentários

    // Separa tokens (remove espaços múltiplos)
    const parts = line.split(/\s+/);
    const cmd   = parts[0];

    if (cmd === 'v') {
      // Posição de vértice: v x y z
      srcPos.push([
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3])
      ]);

    } else if (cmd === 'vt') {
      // Coordenada de textura: vt u v
      // OBJ usa V de baixo para cima; WebGL também (ambos ok)
      srcUV.push([
        parseFloat(parts[1]),
        parseFloat(parts[2] ?? '0')
      ]);

    } else if (cmd === 'vn') {
      // Normal de vértice: vn x y z
      srcNorm.push([
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3])
      ]);

    } else if (cmd === 'f') {
      // Face: f v/vt/vn v/vt/vn v/vt/vn [v/vt/vn]
      // Formatos aceitos:
      //   f 1/2/3        (pos/uv/norm)
      //   f 1//3         (pos//norm, sem uv)
      //   f 1/2          (pos/uv, sem norm)
      //   f 1            (só pos)
      // Índices são 1-based no OBJ.

      const faceVerts = [];
      for (let i = 1; i < parts.length; i++) {
        const token = parts[i];
        if (!token) continue;

        const indices = token.split('/');
        const pi = resolveIdx(indices[0], srcPos.length);
        const ti = indices[1] ? resolveIdx(indices[1], srcUV.length)  : 0;
        const ni = indices[2] ? resolveIdx(indices[2], srcNorm.length) : 0;

        faceVerts.push(getVertex(pi, ti, ni));
      }

      // Triângulos diretos
      if (faceVerts.length === 3) {
        outIdx.push(faceVerts[0], faceVerts[1], faceVerts[2]);
      }
      // Quads e polígonos → fan triangulation
      // Fan: (0,1,2), (0,2,3), (0,3,4), ...
      else if (faceVerts.length >= 4) {
        for (let i = 1; i < faceVerts.length - 1; i++) {
          outIdx.push(faceVerts[0], faceVerts[i], faceVerts[i + 1]);
        }
      }
      // Faces com menos de 3 vértices (linhas) são ignoradas
    }
    // Linhas mtllib, usemtl, o, g, s são ignoradas:
    // todos os modelos usam a mesma textura atlas.
  }

  return {
    positions: new Float32Array(outPos),
    texcoords: new Float32Array(outUV),
    normals:   new Float32Array(outNorm),
    indices:   new Uint32Array(outIdx)   // Uint32 suporta > 65535 vértices (WebGL2)
  };
}
// Iago Kainan Bubolz Braatz


// BOUNDING BOX

/**
 * Calcula a bounding box do modelo a partir dos vértices expandidos.
 * O centro e raio são usados pela câmera de thumbnail em main.js.
 *
 * @param {Float32Array} positions — array plano [x0,y0,z0, x1,y1,z1, ...]
 * @returns {{ min, max, center, radius }}
 */
function computeBBox(positions) {
  let minX =  Infinity, minY =  Infinity, minZ =  Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;  if (x > maxX) maxX = x;
    if (y < minY) minY = y;  if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;  if (z > maxZ) maxZ = z;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  // Raio da esfera que envolve o modelo
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  const radius = Math.max(Math.sqrt(dx*dx + dy*dy + dz*dz) / 2, 0.01);

  return {
    min:    [minX, minY, minZ],
    max:    [maxX, maxY, maxZ],
    center: [cx, cy, cz],
    radius
  };
}


// CRIAÇÃO DE BUFFERS NA GPU

/**
 * Envia a geometria parseada para a GPU.
 *
 * Estrutura de atributos (locations fixas via layout no shader):
 *   location 0 → a_position  (vec3)
 *   location 1 → a_texcoord  (vec2)
 *   location 2 → a_normal    (vec3)
 *
 * VAO guarda o estado de todos os atributos — ao fazer bindVertexArray
 * antes do draw call, todos os ponteiros são restaurados automaticamente.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {{ positions, texcoords, normals, indices }} parsed
 * @returns {{ vao, count, bbox, buffers, name }}
 */
function createGPUModel(gl, parsed) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  // Função auxiliar: cria buffer, faz upload dos dados e liga ao atributo
  function uploadAttrib(data, location, numComponents) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, numComponents, gl.FLOAT, false, 0, 0);
    return buf;
  }

  const posBuffer  = uploadAttrib(parsed.positions, 0, 3);
  const uvBuffer   = uploadAttrib(parsed.texcoords,  1, 2);
  const normBuffer = uploadAttrib(parsed.normals,    2, 3);

  // Buffer de índices (fica dentro do VAO)
  const idxBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, parsed.indices, gl.STATIC_DRAW);

  // Desbinda o VAO para evitar alterações acidentais
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return {
    vao,
    count:   parsed.indices.length,   // número de índices para drawElements
    bbox:    computeBBox(parsed.positions),
    // Guardamos referências para poder fazer dispose() depois
    buffers: [posBuffer, uvBuffer, normBuffer, idxBuffer]
  };
}


// CLASSE ModelLoader

export class ModelLoader {
  /**
   * @param {WebGL2RenderingContext} gl
   */
  constructor(gl) {
    this.gl    = gl;
    this.cache = new Map();  // Map<name, gpuModel>
  }

  // ── Carregamento ──────────────────────────────────────────

  /**
   * Carrega um modelo pelo nome (sem extensão).
   * Busca em models/<name>.obj
   * Se já estiver no cache, retorna imediatamente sem novo fetch.
   *
   * @param {string} name
   * @returns {Promise<object|null>} — dados do modelo na GPU, ou null se falhar
   */
  async load(name) {
    if (this.cache.has(name)) return this.cache.get(name);

    try {
      const res = await fetch(`models/${name}.obj`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const text   = await res.text();
      const parsed = parseOBJ(text);

      if (parsed.indices.length === 0) {
        console.warn(`[loader] "${name}" não produziu triângulos.`);
        return null;
      }

      const model  = createGPUModel(this.gl, parsed);
      model.name   = name;
      this.cache.set(name, model);

      return model;

    } catch (err) {
      // Modelo não encontrado ou arquivo corrompido: apenas avisa e segue
      console.warn(`[loader] Falha ao carregar "${name}": ${err.message}`);
      return null;
    }
  }

  /**
   * Carrega todos os modelos da lista em paralelo (Promise.all).
   * Modelos que falharem são silenciosamente ignorados.
   *
   * @param {string[]} names        — lista de nomes de modelos
   * @param {Function} [onProgress] — callback(carregados, total)
   */
  async loadAll(names, onProgress) {
    let done  = 0;
    const total = names.length;

    await Promise.all(
      names.map(async name => {
        await this.load(name);
        done++;
        if (onProgress) onProgress(done, total);
      })
    );
  }

  // ── Acesso ────────────────────────────────────────────────

  /**
   * Retorna os dados de um modelo já carregado, ou null.
   * Usado pelo renderer a cada frame.
   *
   * @param {string} name
   * @returns {object|null}
   */
  getModel(name) {
    return this.cache.get(name) ?? null;
  }

  /** Retorna lista de todos os nomes no cache */
  getLoadedNames() {
    return [...this.cache.keys()];
  }

  // ── Limpeza ───────────────────────────────────────────────

  /**
   * Libera todos os recursos de GPU.
   * Chamado quando a página é fechada ou o contexto WebGL é perdido.
   */
  dispose() {
    for (const model of this.cache.values()) {
      model.buffers.forEach(buf => this.gl.deleteBuffer(buf));
      this.gl.deleteVertexArray(model.vao);
    }
    this.cache.clear();
  }
}