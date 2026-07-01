export const MODEL_LIST = [
  { name: 'base',                   label: 'Base Tile'         },
  { name: 'road_straight',          label: 'Rua Reta'          },
  { name: 'road_corner',            label: 'Rua Esquina'       },
  { name: 'road_corner_curved',     label: 'Rua Curva'         },
  { name: 'road_tsplit',            label: 'Rua T'             },
  { name: 'road_junction',          label: 'Cruzamento'        },
  { name: 'road_straight_crossing', label: 'Faixa Pedestre'    },
  { name: 'building_A',             label: 'Edifício A'        },
  { name: 'building_B',             label: 'Edifício B'        },
  { name: 'building_C',             label: 'Edifício C'        },
  { name: 'building_D',             label: 'Edifício D'        },
  { name: 'building_E',             label: 'Edifício E'        },
  { name: 'building_F',             label: 'Edifício F'        },
  { name: 'building_G',             label: 'Edifício G'        },
  { name: 'building_H',             label: 'Edifício H'        },
  { name: 'car_sedan',              label: 'Carro Sedan'       },
  { name: 'car_police',             label: 'Carro Polícia'     },
  { name: 'car_hatchback',          label: 'Hatchback'         },
  { name: 'car_taxi',               label: 'Taxi'              },
  { name: 'car_stationwagon',       label: 'Perua'             },
  { name: 'car_sedan_wheel_front_left',  label: 'Roda Frente E' },
  { name: 'car_sedan_wheel_front_right', label: 'Roda Frente D' },
  { name: 'car_sedan_wheel_rear_left',   label: 'Roda Trás E'   },
  { name: 'car_sedan_wheel_rear_right',  label: 'Roda Trás D'   },
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

function resolveIdx(str, length) {
  const n = parseInt(str, 10);
  if (isNaN(n)) return 0;
  return n < 0 ? length + n : n - 1;
}

function parseOBJ(text) {
  const srcPos  = [];
  const srcUV   = [];
  const srcNorm = [];

  const outPos  = [];
  const outUV   = [];
  const outNorm = [];
  const outIdx  = [];

  const vertMap = new Map();
  let nextVert  = 0;

  function getVertex(pi, ti, ni) {
    const key = `${pi}|${ti}|${ni}`;
    if (vertMap.has(key)) return vertMap.get(key);

    const p = srcPos[pi]  ?? [0, 0, 0];
    const t = srcUV[ti]   ?? [0, 0];
    const n = srcNorm[ni] ?? [0, 1, 0];

    outPos.push(p[0], p[1], p[2]);
    outUV.push(t[0], t[1]);
    outNorm.push(n[0], n[1], n[2]);

    vertMap.set(key, nextVert);
    return nextVert++;
  }

  const lines = text.split('\n');
  for (const rawLine of lines) {
    const line  = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const cmd   = parts[0];

    if (cmd === 'v') {
      srcPos.push([
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3])
      ]);

    } else if (cmd === 'vt') {
      srcUV.push([
        parseFloat(parts[1]),
        parseFloat(parts[2] ?? '0')
      ]);

    } else if (cmd === 'vn') {
      srcNorm.push([
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3])
      ]);

    } else if (cmd === 'f') {
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

      if (faceVerts.length === 3) {
        outIdx.push(faceVerts[0], faceVerts[1], faceVerts[2]);
      }
      else if (faceVerts.length >= 4) {
        for (let i = 1; i < faceVerts.length - 1; i++) {
          outIdx.push(faceVerts[0], faceVerts[i], faceVerts[i + 1]);
        }
      }
    }
  }

  return {
    positions: new Float32Array(outPos),
    texcoords: new Float32Array(outUV),
    normals:   new Float32Array(outNorm),
    indices:   new Uint32Array(outIdx)
  };
}

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

function createGPUModel(gl, parsed) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

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

  const idxBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, parsed.indices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return {
    vao,
    count:   parsed.indices.length,
    bbox:    computeBBox(parsed.positions),
    buffers: [posBuffer, uvBuffer, normBuffer, idxBuffer]
  };
}

export class ModelLoader {
  constructor(gl) {
    this.gl    = gl;
    this.cache = new Map();
  }

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
      console.warn(`[loader] Falha ao carregar "${name}": ${err.message}`);
      return null;
    }
  }

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

  getModel(name) {
    return this.cache.get(name) ?? null;
  }

  getLoadedNames() {
    return [...this.cache.keys()];
  }

  dispose() {
    for (const model of this.cache.values()) {
      model.buffers.forEach(buf => this.gl.deleteBuffer(buf));
      this.gl.deleteVertexArray(model.vao);
    }
    this.cache.clear();
  }
}