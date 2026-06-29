/**
 * main.js — Ponto de entrada do Editor de Cena 3D
 *
 * Baseado nos tutoriais WebGL2Fundamentals.org:
 *  ─ Boilerplate      : compileShader, createProgram
 *  ─ Animation        : requestAnimationFrame com deltaTime frame-rate independent
 *  ─ Drawing Multiple : loop de objectsToDraw com bindVertexArray por objeto
 *  ─ Scene Graphs     : scene.update() reconstrói worldMatrix recursivamente
 *  ─ Picking          : FBO off-screen, readPixels, decode ID por cor RGBA
 *  ─ Render to Texture: thumbnails dos modelos gerados off-screen
 *
 * Sequência de inicialização:
 *  1. Criar contexto WebGL2
 *  2. Compilar shaders (main + picking)
 *  3. Carregar textura citybits_texture.png
 *  4. Inicializar scene, camera, loader, editor
 *  5. Carregar todos os modelos OBJ com barra de progresso
 *  6. Gerar thumbnails (render off-screen de cada modelo)
 *  7. Construir painel de modelos no editor
 *  8. Criar FBO de picking
 *  9. Configurar event listeners (click para picking, mousedown para drag)
 * 10. Iniciar loop de renderização
 */

import { mat4Create, mat4Perspective, mat4LookAt, mat3NormalMatrix } from './js/math.js';
import { ModelLoader, MODEL_LIST }                                    from './js/loader.js';
import { Scene }                                                      from './js/scene.js';
import { Camera }                                                     from './js/camera.js';
import { Editor }                                                     from './js/editor.js';


// ─────────────────────────────────────────────────────────────────────────────
// SHADERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vertex shader principal.
 *
 * layout(location = N) garante que os atributos ficam nas mesmas locations
 * em TODOS os programas que usam este VAO — incluindo o shader de picking.
 * Isso significa que criamos um único VAO por modelo e o usamos nos dois
 * programas sem precisar reconfigurar atributos.
 * (Padrão diretamente do tutorial de picking do webgl2fundamentals.)
 */
const VS_SRC = `#version 300 es

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec2 a_texcoord;
layout(location = 2) in vec3 a_normal;

uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
uniform mat3 u_normalMatrix;
uniform vec2 u_texOffset;
uniform vec2 u_texScale;

out vec2 v_texcoord;
out vec3 v_normal;

void main() {
  v_texcoord = a_texcoord * u_texScale + u_texOffset;

  v_normal = u_normalMatrix * a_normal;

  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}
`;

/**
 * Fragment shader principal: textura × iluminação difusa + highlight de seleção.
 */
const FS_SRC = `#version 300 es
precision highp float;

in vec2 v_texcoord;
in vec3 v_normal;

uniform sampler2D u_texture;
uniform vec3      u_lightDir;
uniform float     u_ambient;
uniform int       u_selected;
uniform vec3      u_tint;

out vec4 outColor;

void main() {
  vec4 texColor = texture(u_texture, v_texcoord);

  if (texColor.a < 0.1) discard;

  texColor.rgb *= u_tint;

  float diff  = max(dot(normalize(v_normal), normalize(u_lightDir)), 0.0);
  float light = u_ambient + diff * (1.0 - u_ambient);
  vec3  color = texColor.rgb * light;

  if (u_selected == 1) {
    color = mix(color, vec3(1.0, 0.85, 0.1), 0.4);
  }

  outColor = vec4(color, texColor.a);
}
`;

/**
 * Vertex shader de picking.
 * Só precisa de a_position (location 0) — mesma que no shader principal.
 * UV e normal são ignorados, mas o VAO ainda tem esses buffers configurados.
 */
const PICK_VS_SRC = `#version 300 es

layout(location = 0) in vec3 a_position;

uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;

void main() {
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}
`;

/**
 * Fragment shader de picking.
 * Cada objeto recebe u_id com seu ID codificado como cor RGBA.
 * Baseado exatamente no tutorial de picking do webgl2fundamentals.
 */
const PICK_FS_SRC = `#version 300 es
precision highp float;

uniform vec4 u_id;

out vec4 outColor;

void main() {
  outColor = u_id;
}
`;


// ─────────────────────────────────────────────────────────────────────────────
// BOILERPLATE — seguindo exatamente o tutorial "WebGL2 Boilerplate"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compila um único shader GLSL.
 * Lança erro com o log de compilação se falhar.
 * Código diretamente do tutorial de boilerplate.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {string} source   — código GLSL
 * @param {number} type     — gl.VERTEX_SHADER ou gl.FRAGMENT_SHADER
 * @returns {WebGLShader}
 */
function compileShader(gl, source, type) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Erro de compilação no shader:\n${log}`);
  }
  return shader;
}

/**
 * Linka dois shaders em um programa WebGL.
 * Lança erro com o log de link se falhar.
 * Código diretamente do tutorial de boilerplate.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {string} vsSrc — fonte do vertex shader
 * @param {string} fsSrc — fonte do fragment shader
 * @returns {WebGLProgram}
 */
function createProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, vsSrc, gl.VERTEX_SHADER);
  const fs = compileShader(gl, fsSrc, gl.FRAGMENT_SHADER);

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Erro de link do programa:\n${log}`);
  }

  // Shaders podem ser deletados após o link — o programa já tem tudo
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  return program;
}

/**
 * Agrupa um programa WebGL com os locations de todos os seus uniforms.
 *
 * Buscar locations uma única vez na inicialização e armazenar em cache
 * é muito mais eficiente do que chamar getUniformLocation a cada frame.
 * Para N objetos renderizados a 60fps, isso economiza N×60 chamadas/seg.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram}           program
 * @param {string[]}               uniformNames
 * @returns {{ program, locs }}
 */
function createProgramInfo(gl, program, uniformNames) {
  const locs = {};
  for (const name of uniformNames) {
    locs[name] = gl.getUniformLocation(program, name);
  }
  return { program, locs };
}


// ─────────────────────────────────────────────────────────────────────────────
// CANVAS RESIZE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ajusta o drawing buffer do canvas para corresponder ao seu tamanho CSS.
 *
 * O canvas tem DOIS tamanhos:
 *  ─ CSS size  (canvas.clientWidth/Height) : espaço ocupado na página
 *  ─ Buffer size (canvas.width/height)     : resolução do WebGL
 * Sem esse ajuste, o WebGL renderiza em resolução errada.
 *
 * Retorna true se o tamanho mudou (sinaliza que o pickFBO precisa ser recriado).
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {boolean}
 */
function resizeCanvas(canvas) {
  const w = canvas.clientWidth  | 0;
  const h = canvas.clientHeight | 0;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width  = w;
    canvas.height = h;
    return true;
  }
  return false;
}


// ─────────────────────────────────────────────────────────────────────────────
// TEXTURA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Carrega uma imagem e a envia para a GPU como textura WebGL2.
 *
 * Enquanto a imagem carrega (fetch assíncrono), a textura contém um
 * pixel cinza (placeholder) para que a cena não quebre.
 *
 * Mipmaps são gerados automaticamente para melhorar a qualidade quando
 * os modelos estão distantes (sem aliasing nas texturas).
 *
 * @param {WebGL2RenderingContext} gl
 * @param {string} url
 * @returns {Promise<WebGLTexture>}
 */
function loadTexture(gl, url) {
  return new Promise((resolve, reject) => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Pixel cinza placeholder — evita erros enquanto a imagem não carregou
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA,
      1, 1, 0,
      gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([128, 128, 128, 255])
    );

    const img = new Image();

    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      resolve(texture);
    };

    img.onerror = () => reject(new Error(`Falha ao carregar textura: ${url}`));
    img.src = url;
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// FRAMEBUFFER DE PICKING — baseado no tutorial "WebGL2 Picking"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria um framebuffer off-screen para o sistema de picking por cor.
 *
 * Estrutura (diretamente do tutorial de picking):
 *  ─ Textura RGBA     : armazena as cores (= IDs codificados dos objetos)
 *  ─ Renderbuffer Z16 : depth test durante o picking (objetos frontais
 *                       tapam os traseiros, como na cena principal)
 *
 * Usa NEAREST (sem interpolação) na textura para que as cores de ID
 * sejam lidas de forma precisa — interpolação distorceria o ID.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {number} width
 * @param {number} height
 * @returns {{ fb, colorTex, depthRB, width, height }}
 */
function createPickFBO(gl, width, height) {
  const colorTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, colorTex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA,
    width, height, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const depthRB = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthRB);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);

  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D, colorTex, 0
  );
  gl.framebufferRenderbuffer(
    gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
    gl.RENDERBUFFER, depthRB
  );

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, colorTex, depthRB, width, height };
}

/**
 * Libera todos os recursos GPU de um FBO.
 * Chamado quando o canvas é redimensionado.
 */
function destroyFBO(gl, fbo) {
  if (!fbo) return;
  gl.deleteFramebuffer(fbo.fb);
  gl.deleteTexture(fbo.colorTex);
  gl.deleteRenderbuffer(fbo.depthRB);
}


// ─────────────────────────────────────────────────────────────────────────────
// ENCODE / DECODE DE IDS — diretamente do tutorial de picking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Codifica um ID inteiro (1-based) em vetor RGBA [0..1].
 *
 * Distribui os 32 bits do ID por 4 canais de 8 bits:
 *   R = bits  0-7
 *   G = bits  8-15
 *   B = bits 16-23
 *   A = bits 24-31
 *
 * Suporta até 2³² IDs únicos — mais que suficiente para qualquer cena.
 * ID 0 é reservado para o fundo (nenhum objeto clicado).
 *
 * @param {number} id — 1-based
 * @returns {number[4]} — RGBA normalizado [0..1]
 */
function encodeId(id) {
  return [
    ((id >>  0) & 0xFF) / 0xFF,
    ((id >>  8) & 0xFF) / 0xFF,
    ((id >> 16) & 0xFF) / 0xFF,
    ((id >> 24) & 0xFF) / 0xFF,
  ];
}

/**
 * Decodifica 4 bytes RGBA (0-255) lidos por readPixels de volta ao ID.
 *
 * @param {number} r, g, b, a — valores 0-255
 * @returns {number} ID do objeto, ou 0 para fundo
 */
function decodeId(r, g, b, a) {
  return r + (g << 8) + (b << 16) + (a << 24);
}


// ─────────────────────────────────────────────────────────────────────────────
// RENDERIZAÇÃO DA CENA PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renderiza todos os objetos da cena com o shader principal
 * (textura + iluminação + highlight de seleção).
 *
 * Segue o padrão do tutorial "Drawing Multiple Things":
 *  1. gl.useProgram UMA vez (não trocamos de programa neste loop)
 *  2. Uniforms compartilhados UMA vez (proj, view, luz, textura)
 *  3. Loop por objeto: uniforms por objeto + bind VAO + drawElements
 *
 * Otimização do tutorial: só chama gl.bindVertexArray quando o VAO
 * é DIFERENTE do anterior — evita bind redundante.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {{ program, locs }}     progInfo
 * @param {Scene}                 scene
 * @param {ModelLoader}           loader
 * @param {Float32Array}          proj
 * @param {Float32Array}          view
 * @param {number|null}           selectedId
 * @param {WebGLTexture}          texture
 */
function drawObjects(gl, progInfo, scene, loader, proj, view, selectedId, texture) {
  gl.useProgram(progInfo.program);

  // ── Uniforms compartilhados (enviados UMA vez por frame) ──────────────
  gl.uniformMatrix4fv(progInfo.locs.u_projection, false, proj);
  gl.uniformMatrix4fv(progInfo.locs.u_view,       false, view);
  gl.uniform3fv(progInfo.locs.u_lightDir, [1.0, 2.0, 1.5]);
  gl.uniform1f(progInfo.locs.u_ambient, 0.35);
  gl.uniform1i(progInfo.locs.u_texture, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);

  // ── Loop pelos objetos da cena ───────────────────────────────────────
  let lastVAO = null;

  for (const node of scene.getAllNodes()) {
    const modelData = loader.getModel(node.modelName);
    if (!modelData) continue;  // modelo falhou ao carregar: pula

    // Uniforms por objeto
    gl.uniformMatrix4fv(progInfo.locs.u_model, false, node.worldMatrix);
    gl.uniformMatrix3fv(
      progInfo.locs.u_normalMatrix, false,
      mat3NormalMatrix(node.worldMatrix)
    );
    gl.uniform1i(progInfo.locs.u_selected, node.id === selectedId ? 1 : 0);

    // Propriedades de textura por objeto
    const tex = node.texture;
    gl.uniform3fv(progInfo.locs.u_tint,      [tex.tintR, tex.tintG, tex.tintB]);
    gl.uniform2fv(progInfo.locs.u_texOffset, [tex.offsetU, tex.offsetV]);
    gl.uniform2fv(progInfo.locs.u_texScale,  [tex.scaleU,  tex.scaleV]);

    // Bind VAO apenas quando muda (otimização do tutorial)
    if (modelData.vao !== lastVAO) {
      gl.bindVertexArray(modelData.vao);
      lastVAO = modelData.vao;
    }

    gl.drawElements(gl.TRIANGLES, modelData.count, gl.UNSIGNED_INT, 0);
  }

  gl.bindVertexArray(null);
}


// ─────────────────────────────────────────────────────────────────────────────
// RENDERIZAÇÃO DE PICKING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renderiza todos os objetos com o shader de picking (sem textura,
 * cada objeto recebe uma cor sólida = seu ID codificado em RGBA).
 *
 * Executado apenas no evento de clique (não todo frame).
 * O resultado fica no FBO off-screen — o usuário não vê.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {{ program, locs }}     progInfo — picking program info
 * @param {Scene}                 scene
 * @param {ModelLoader}           loader
 * @param {Float32Array}          proj
 * @param {Float32Array}          view
 */
function drawPickObjects(gl, progInfo, scene, loader, proj, view) {
  gl.useProgram(progInfo.program);

  gl.uniformMatrix4fv(progInfo.locs.u_projection, false, proj);
  gl.uniformMatrix4fv(progInfo.locs.u_view,       false, view);

  let lastVAO = null;

  for (const node of scene.getAllNodes()) {
    const modelData = loader.getModel(node.modelName);
    if (!modelData) continue;

    gl.uniform4fv(progInfo.locs.u_id, encodeId(node.id));
    gl.uniformMatrix4fv(progInfo.locs.u_model, false, node.worldMatrix);

    if (modelData.vao !== lastVAO) {
      gl.bindVertexArray(modelData.vao);
      lastVAO = modelData.vao;
    }

    gl.drawElements(gl.TRIANGLES, modelData.count, gl.UNSIGNED_INT, 0);
  }

  gl.bindVertexArray(null);
}


// ─────────────────────────────────────────────────────────────────────────────
// THUMBNAILS — render off-screen de cada modelo para o painel direito
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renderiza um único modelo em um FBO 96×96 e retorna um data URL PNG.
 *
 * A câmera é posicionada em ângulo isométrico (azimute 45°, elevação 25°)
 * a uma distância calculada para enquadrar o modelo completamente.
 *
 * Inversão de Y: gl.readPixels lê de baixo para cima (origem = canto
 * inferior esquerdo do WebGL), mas canvas 2D escreve de cima para baixo.
 * Sem a inversão, os thumbnails aparecem de cabeça para baixo.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {{ program, locs }}     progInfo — main program info
 * @param {WebGLTexture}          texture
 * @param {object}                model    — { vao, count, bbox }
 * @param {WebGLFramebuffer}      fb       — FBO off-screen reutilizável
 * @param {number}                size     — dimensão do thumbnail em pixels
 * @returns {string} data URL (PNG)
 */
function renderThumbnail(gl, progInfo, texture, model, fb, size) {
  const { center, radius } = model.bbox;

  // Câmera isométrica enquadrando o modelo
  const fovY = Math.PI / 4;
  const dist = (radius / Math.tan(fovY / 2)) * 1.8;  // 1.8× = margem generosa
  const az   = 45 * Math.PI / 180;
  const el   = 25 * Math.PI / 180;

  const eye = [
    center[0] + dist * Math.cos(el) * Math.sin(az),
    center[1] + dist * Math.sin(el),
    center[2] + dist * Math.cos(el) * Math.cos(az),
  ];

  const proj     = mat4Perspective(fovY, 1.0, dist * 0.01, dist * 20);
  const view     = mat4LookAt(eye, center, [0, 1, 0]);
  const identity = mat4Create();

  // Renderiza para o FBO off-screen
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.viewport(0, 0, size, size);
  gl.clearColor(0.13, 0.15, 0.20, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.useProgram(progInfo.program);
  gl.uniformMatrix4fv(progInfo.locs.u_projection,  false, proj);
  gl.uniformMatrix4fv(progInfo.locs.u_view,         false, view);
  gl.uniformMatrix4fv(progInfo.locs.u_model,        false, identity);
  gl.uniformMatrix3fv(progInfo.locs.u_normalMatrix, false, mat3NormalMatrix(identity));
  gl.uniform1i(progInfo.locs.u_texture,  0);
  gl.uniform3fv(progInfo.locs.u_lightDir, [1.0, 2.0, 1.5]);
  gl.uniform1f(progInfo.locs.u_ambient,  0.35);
  gl.uniform1i(progInfo.locs.u_selected, 0);
  // Thumbnail sempre usa textura sem modificação
  gl.uniform3fv(progInfo.locs.u_tint,      [1, 1, 1]);
  gl.uniform2fv(progInfo.locs.u_texOffset, [0, 0]);
  gl.uniform2fv(progInfo.locs.u_texScale,  [1, 1]);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);

  gl.bindVertexArray(model.vao);
  gl.drawElements(gl.TRIANGLES, model.count, gl.UNSIGNED_INT, 0);
  gl.bindVertexArray(null);

  // Lê os pixels renderizados
  const pixels = new Uint8Array(size * size * 4);
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  // Copia para canvas 2D com inversão de Y
  const c2d     = document.createElement('canvas');
  c2d.width     = size;
  c2d.height    = size;
  const ctx     = c2d.getContext('2d');
  const imgData = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4;  // lê de baixo para cima
    const dstRow = y * size * 4;               // escreve de cima para baixo
    imgData.data.set(pixels.subarray(srcRow, srcRow + size * 4), dstRow);
  }

  ctx.putImageData(imgData, 0, 0);
  return c2d.toDataURL('image/png');
}

/**
 * Gera thumbnails de todos os modelos carregados.
 *
 * Cria um único FBO reutilizável para não desperdiçar memória criando
 * e destruindo um FBO por modelo. Após gerar todos os thumbnails,
 * limpa o FBO e restaura o estado do GL.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {{ program, locs }}     progInfo
 * @param {WebGLTexture}          texture
 * @param {ModelLoader}           loader
 * @returns {Object} { nomeDotModelo: dataURL, ... }
 */
function generateAllThumbnails(gl, progInfo, texture, loader) {
  const SIZE = 96;

  // FBO reutilizável para todos os thumbnails
  const colorTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, colorTex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA,
    SIZE, SIZE, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const depthRB = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthRB);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SIZE, SIZE);

  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D, colorTex, 0
  );
  gl.framebufferRenderbuffer(
    gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
    gl.RENDERBUFFER, depthRB
  );

  const thumbnails = {};

  for (const modelInfo of MODEL_LIST) {
    const model = loader.getModel(modelInfo.name);
    if (!model) continue;
    thumbnails[modelInfo.name] = renderThumbnail(
      gl, progInfo, texture, model, fb, SIZE
    );
  }

  // Limpeza: destrói FBO temporário e restaura estado do GL
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(colorTex);
  gl.deleteRenderbuffer(depthRB);

  return thumbnails;
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {

  // ── 1. Canvas e contexto WebGL2 ────────────────────────────────────────────
  const canvas = document.getElementById('gl-canvas');
  const gl     = canvas.getContext('webgl2', {
    alpha:     false,  // sem canal alpha no framebuffer principal (performance)
    antialias: true,   // MSAA se disponível
  });

  if (!gl) {
    alert(
      'WebGL2 não está disponível no seu navegador.\n' +
      'Tente Chrome, Firefox ou Edge atualizados.'
    );
    return;
  }

  // Estado WebGL global — ativado uma vez, permanece para toda a sessão
  gl.enable(gl.DEPTH_TEST);  // objetos frontais tapam os que estão atrás
  gl.enable(gl.CULL_FACE);   // descarta faces traseiras (CW) → performance
  gl.cullFace(gl.BACK);      // padrão WebGL: faces CCW = frontais

  // ── 2. Compilar shaders ────────────────────────────────────────────────────
  const mainProgram = createProgram(gl, VS_SRC, FS_SRC);
  const pickProgram = createProgram(gl, PICK_VS_SRC, PICK_FS_SRC);

  // ProgramInfo: programa + locations de todos os uniforms (em cache)
  const mainProgInfo = createProgramInfo(gl, mainProgram, [
    'u_projection', 'u_view', 'u_model', 'u_normalMatrix',
    'u_texture', 'u_lightDir', 'u_ambient', 'u_selected',
    'u_tint', 'u_texOffset', 'u_texScale'
  ]);

  const pickProgInfo = createProgramInfo(gl, pickProgram, [
    'u_projection', 'u_view', 'u_model', 'u_id'
  ]);

  // ── 3. Carregar textura ────────────────────────────────────────────────────
  // Todos os modelos CityBits compartilham um único atlas de textura
  const texture = await loadTexture(gl, 'textures/citybits_texture.png');

  // ── 4. Inicializar sistemas ────────────────────────────────────────────────
  const scene  = new Scene();
  const camera = new Camera(canvas);
  const loader = new ModelLoader(gl);
  const editor = new Editor(scene, loader);

  // ── 5. Carregar modelos com barra de progresso ─────────────────────────────
  const modelNames = MODEL_LIST.map(m => m.name);

  await loader.loadAll(modelNames, (loaded, total) => {
    editor.setLoadingProgress(loaded, total);
  });

  console.log(`[main] ${loader.getLoadedNames().length} modelos carregados.`);

  // ── 6. Gerar thumbnails e construir painel de modelos ──────────────────────
  const thumbnails = generateAllThumbnails(gl, mainProgInfo, texture, loader);
  editor.buildModelPanel(thumbnails);

  // ── 7. Criar FBO de picking ────────────────────────────────────────────────
  resizeCanvas(canvas);
  let pickFBO = createPickFBO(gl, canvas.width, canvas.height);

  // ── 8. Construir lista de cena inicial (vazia) ─────────────────────────────
  editor.refreshSceneList();

  // ── 9. Detecção de drag vs clique ──────────────────────────────────────────
  // O browser dispara 'click' apenas se o mouse não se moveu muito entre
  // mousedown e mouseup. Adicionamos verificação extra de 5px para
  // robustez entre diferentes browsers e dispositivos.
  let mouseDownX = 0;
  let mouseDownY = 0;

  canvas.addEventListener('mousedown', (e) => {
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
  });

  // ── 10. Picking ao clicar no canvas ───────────────────────────────────────
  canvas.addEventListener('click', (e) => {
    // Ignora se o mouse se moveu mais de 5px (foi um drag, não um clique)
    const ddx = e.clientX - mouseDownX;
    const ddy = e.clientY - mouseDownY;
    if (Math.sqrt(ddx * ddx + ddy * ddy) > 5) return;

    const rect = canvas.getBoundingClientRect();

    // Conversão CSS pixels → WebGL pixels
    // Fórmula diretamente do tutorial de picking:
    //   pixelX = mouseX * canvasWidth  / canvasClientWidth
    //   pixelY = canvasHeight - mouseY * canvasHeight / canvasClientHeight - 1
    // O -1 é porque readPixels usa intervalo [0, height-1]
    const pixelX = (e.clientX - rect.left)
                   * canvas.width  / canvas.clientWidth;
    const pixelY = canvas.height
                   - (e.clientY - rect.top)
                   * canvas.height / canvas.clientHeight
                   - 1;

    // Calcula matrizes de câmera para este frame
    const aspect = canvas.width / canvas.height;
    const proj   = camera.getProjectionMatrix(aspect);
    const view   = camera.getViewMatrix();

    // Renderiza cena off-screen com IDs como cores
    gl.bindFramebuffer(gl.FRAMEBUFFER, pickFBO.fb);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);  // preto puro = ID 0 = fundo = nenhum objeto
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawPickObjects(gl, pickProgInfo, scene, loader, proj, view);

    // Lê o pixel sob o cursor — 1×1 pixel = 4 bytes RGBA
    const pixel = new Uint8Array(4);
    gl.readPixels(
      Math.floor(pixelX),
      Math.floor(pixelY),
      1, 1,
      gl.RGBA, gl.UNSIGNED_BYTE,
      pixel
    );

    // Restaura framebuffer principal imediatamente após readPixels
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Decodifica ID e atualiza seleção no editor
    const clickedId = decodeId(pixel[0], pixel[1], pixel[2], pixel[3]);
    editor.selectNode(clickedId > 0 ? clickedId : null);
    editor.refreshSceneList();
  });

  // ── 11. Loop de renderização ───────────────────────────────────────────────
  // Baseado EXATAMENTE no tutorial de animação do webgl2fundamentals:
  //
  //   var then = 0;
  //   function drawScene(now) {
  //     now *= 0.001;             // converte para segundos
  //     var deltaTime = now - then;
  //     then = now;
  //     ...
  //     requestAnimationFrame(drawScene);
  //   }
  //   requestAnimationFrame(drawScene);
  //
  // O deltaTime garante animações frame-rate independent:
  // a cena anima à mesma velocidade em 30fps e em 144fps.
  let then = 0;

  function render(now) {
    // Converte milissegundos → segundos (tutorial de animação)
    now *= 0.001;
    const dt = Math.min(now - then, 0.1);  // cap de 100ms evita salto após aba inativa
    then = now;

    // Redimensiona canvas se a janela mudou de tamanho
    const resized = resizeCanvas(canvas);
    if (resized) {
      // O FBO de picking PRECISA ter o mesmo tamanho do canvas
      destroyFBO(gl, pickFBO);
      pickFBO = createPickFBO(gl, canvas.width, canvas.height);
    }
    // Iago Kainan Bubolz Braatz


    gl.viewport(0, 0, canvas.width, canvas.height);

    // Atualiza animações + reconstrói worldMatrix de todo o grafo de cena
    scene.update(dt);

    // Limpa e renderiza a cena principal
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0.15, 0.17, 0.22, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = canvas.width / canvas.height;
    const proj   = camera.getProjectionMatrix(aspect);
    const view   = camera.getViewMatrix();

    drawObjects(
      gl, mainProgInfo, scene, loader,
      proj, view,
      editor.getSelectedId(),
      texture
    );

    // Solicita o próximo frame
    requestAnimationFrame(render);
  }

  // Dispara o loop
  requestAnimationFrame(render);
}

// Executa e captura qualquer erro não tratado
main().catch(err => {
  console.error('[main] Erro fatal na inicialização:', err);
  alert(`Erro ao inicializar o editor:\n\n${err.message}`);
});