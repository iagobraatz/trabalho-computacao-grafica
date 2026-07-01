import { mat4Create, mat4Perspective, mat4LookAt, mat3NormalMatrix } from './js/math.js';
import { ModelLoader, MODEL_LIST }                                    from './js/loader.js';
import { Scene }                                                      from './js/scene.js';
import { Camera }                                                     from './js/camera.js';
import { Editor }                                                     from './js/editor.js';

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

const PICK_VS_SRC = `#version 300 es

layout(location = 0) in vec3 a_position;

uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;

void main() {
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}
`;

const PICK_FS_SRC = `#version 300 es
precision highp float;

uniform vec4 u_id;

out vec4 outColor;

void main() {
  outColor = u_id;
}
`;

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

  gl.deleteShader(vs);
  gl.deleteShader(fs);

  return program;
}

function createProgramInfo(gl, program, uniformNames) {
  const locs = {};
  for (const name of uniformNames) {
    locs[name] = gl.getUniformLocation(program, name);
  }
  return { program, locs };
}

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

function loadTexture(gl, url) {
  return new Promise((resolve, reject) => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

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

function destroyFBO(gl, fbo) {
  if (!fbo) return;
  gl.deleteFramebuffer(fbo.fb);
  gl.deleteTexture(fbo.colorTex);
  gl.deleteRenderbuffer(fbo.depthRB);
}

function encodeId(id) {
  return [
    ((id >>  0) & 0xFF) / 0xFF,
    ((id >>  8) & 0xFF) / 0xFF,
    ((id >> 16) & 0xFF) / 0xFF,
    ((id >> 24) & 0xFF) / 0xFF,
  ];
}

function decodeId(r, g, b, a) {
  return r + (g << 8) + (b << 16) + (a << 24);
}

function drawObjects(gl, progInfo, scene, loader, proj, view, selectedId, texture) {
  gl.useProgram(progInfo.program);

  gl.uniformMatrix4fv(progInfo.locs.u_projection, false, proj);
  gl.uniformMatrix4fv(progInfo.locs.u_view,       false, view);
  gl.uniform3fv(progInfo.locs.u_lightDir, [1.0, 2.0, 1.5]);
  gl.uniform1f(progInfo.locs.u_ambient, 0.35);
  gl.uniform1i(progInfo.locs.u_texture, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);

  let lastVAO = null;

  for (const node of scene.getAllNodes()) {
    const modelData = loader.getModel(node.modelName);
    if (!modelData) continue;

    gl.uniformMatrix4fv(progInfo.locs.u_model, false, node.worldMatrix);
    gl.uniformMatrix3fv(
      progInfo.locs.u_normalMatrix, false,
      mat3NormalMatrix(node.worldMatrix)
    );
    gl.uniform1i(progInfo.locs.u_selected, node.id === selectedId ? 1 : 0);

    const tex = node.texture;
    gl.uniform3fv(progInfo.locs.u_tint,      [tex.tintR, tex.tintG, tex.tintB]);
    gl.uniform2fv(progInfo.locs.u_texOffset, [tex.offsetU, tex.offsetV]);
    gl.uniform2fv(progInfo.locs.u_texScale,  [tex.scaleU,  tex.scaleV]);

    if (modelData.vao !== lastVAO) {
      gl.bindVertexArray(modelData.vao);
      lastVAO = modelData.vao;
    }

    gl.drawElements(gl.TRIANGLES, modelData.count, gl.UNSIGNED_INT, 0);
  }

  gl.bindVertexArray(null);
}

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

function renderThumbnail(gl, progInfo, texture, model, fb, size) {
  const { center, radius } = model.bbox;

  const fovY = Math.PI / 4;
  const dist = (radius / Math.tan(fovY / 2)) * 1.8;
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
  gl.uniform3fv(progInfo.locs.u_tint,      [1, 1, 1]);
  gl.uniform2fv(progInfo.locs.u_texOffset, [0, 0]);
  gl.uniform2fv(progInfo.locs.u_texScale,  [1, 1]);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);

  gl.bindVertexArray(model.vao);
  gl.drawElements(gl.TRIANGLES, model.count, gl.UNSIGNED_INT, 0);
  gl.bindVertexArray(null);

  const pixels = new Uint8Array(size * size * 4);
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  const c2d     = document.createElement('canvas');
  c2d.width     = size;
  c2d.height    = size;
  const ctx     = c2d.getContext('2d');
  const imgData = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4;
    const dstRow = y * size * 4;
    imgData.data.set(pixels.subarray(srcRow, srcRow + size * 4), dstRow);
  }

  ctx.putImageData(imgData, 0, 0);
  return c2d.toDataURL('image/png');
}

function generateAllThumbnails(gl, progInfo, texture, loader) {
  const SIZE = 96;

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

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(colorTex);
  gl.deleteRenderbuffer(depthRB);

  return thumbnails;
}

async function main() {

  const canvas = document.getElementById('gl-canvas');
  const gl     = canvas.getContext('webgl2', {
    alpha:     false,
    antialias: true,
  });

  if (!gl) {
    alert(
      'WebGL2 não está disponível no seu navegador.\n' +
      'Tente Chrome, Firefox ou Edge atualizados.'
    );
    return;
  }

  gl.enable(gl.DEPTH_TEST);  
  gl.enable(gl.CULL_FACE);  
  gl.cullFace(gl.BACK);     

  const mainProgram = createProgram(gl, VS_SRC, FS_SRC);
  const pickProgram = createProgram(gl, PICK_VS_SRC, PICK_FS_SRC);

  const mainProgInfo = createProgramInfo(gl, mainProgram, [
    'u_projection', 'u_view', 'u_model', 'u_normalMatrix',
    'u_texture', 'u_lightDir', 'u_ambient', 'u_selected',
    'u_tint', 'u_texOffset', 'u_texScale'
  ]);

  const pickProgInfo = createProgramInfo(gl, pickProgram, [
    'u_projection', 'u_view', 'u_model', 'u_id'
  ]);

  const texture = await loadTexture(gl, 'textures/citybits_texture.png');

  const scene  = new Scene();
  const camera = new Camera(canvas);
  const loader = new ModelLoader(gl);
  const editor = new Editor(scene, loader);

  const modelNames = MODEL_LIST.map(m => m.name);

  await loader.loadAll(modelNames, (loaded, total) => {
    editor.setLoadingProgress(loaded, total);
  });

  console.log(`[main] ${loader.getLoadedNames().length} modelos carregados.`);

  const thumbnails = generateAllThumbnails(gl, mainProgInfo, texture, loader);
  editor.buildModelPanel(thumbnails);

  resizeCanvas(canvas);
  let pickFBO = createPickFBO(gl, canvas.width, canvas.height);

  editor.refreshSceneList();

  let mouseDownX = 0;
  let mouseDownY = 0;

  canvas.addEventListener('mousedown', (e) => {
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
  });

  canvas.addEventListener('click', (e) => {
    const ddx = e.clientX - mouseDownX;
    const ddy = e.clientY - mouseDownY;
    if (Math.sqrt(ddx * ddx + ddy * ddy) > 5) return;

    const rect = canvas.getBoundingClientRect();

    const pixelX = (e.clientX - rect.left)
                   * canvas.width  / canvas.clientWidth;
    const pixelY = canvas.height
                   - (e.clientY - rect.top)
                   * canvas.height / canvas.clientHeight
                   - 1;

    const aspect = canvas.width / canvas.height;
    const proj   = camera.getProjectionMatrix(aspect);
    const view   = camera.getViewMatrix();

    gl.bindFramebuffer(gl.FRAMEBUFFER, pickFBO.fb);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawPickObjects(gl, pickProgInfo, scene, loader, proj, view);

    const pixel = new Uint8Array(4);
    gl.readPixels(
      Math.floor(pixelX),
      Math.floor(pixelY),
      1, 1,
      gl.RGBA, gl.UNSIGNED_BYTE,
      pixel
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const clickedId = decodeId(pixel[0], pixel[1], pixel[2], pixel[3]);
    editor.selectNode(clickedId > 0 ? clickedId : null);
    editor.refreshSceneList();
  });

  let then = 0;

  function render(now) {
    now *= 0.001;
    const dt = Math.min(now - then, 0.1);
    then = now;

    const resized = resizeCanvas(canvas);
    if (resized) {
      destroyFBO(gl, pickFBO);
      pickFBO = createPickFBO(gl, canvas.width, canvas.height);
    }

    gl.viewport(0, 0, canvas.width, canvas.height);

    scene.update(dt);

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

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

main().catch(err => {
  console.error('[main] Erro fatal na inicialização:', err);
  alert(`Erro ao inicializar o editor:\n\n${err.message}`);
});