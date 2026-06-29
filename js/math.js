/**
 * math.js — Matemática matricial para WebGL
 *
 * Layout visual de uma mat4:
 *   [0]  [4]  [8]  [12]   <- linha 0
 *   [1]  [5]  [9]  [13]   <- linha 1
 *   [2]  [6]  [10] [14]   <- linha 2
 *   [3]  [7]  [11] [15]   <- linha 3
 *
 * A translação fica nos índices [12], [13], [14].
 * Pipeline: gl_Position = Projection * View * Model * vertice
 */
// MAT4 — Matriz 4×4
/** Retorna uma matriz identidade 4×4 (Float32Array de 16 elementos) */
export function mat4Create() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ]);
}

/**
 * Multiplica duas matrizes 4×4: resultado = a * b
 * No pipeline WebGL isso significa: aplica b primeiro, depois a.
 */
export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/**
 * Matriz de projeção perspectiva.
 * @param {number} fovY   — campo de visão vertical em radianos
 * @param {number} aspect — largura / altura do viewport
 * @param {number} near   — plano de corte próximo (positivo)
 * @param {number} far    — plano de corte distante (positivo)
 */
export function mat4Perspective(fovY, aspect, near, far) {
  const f  = 1.0 / Math.tan(fovY * 0.5);
  const nf = 1.0 / (near - far);
  return new Float32Array([
    f / aspect, 0,            0,                   0,
    0,          f,            0,                   0,
    0,          0, (far + near) * nf,             -1,
    0,          0,  2 * far * near * nf,            0
  ]);
}

/**
 * Matriz de câmera (view matrix).
 * Sistema de coordenadas destro (OpenGL): câmera olha para -Z.
 *
 * Derivação:
 *   z_axis = normalize(eye - center)  → eixo que aponta DA cena PARA a câmera
 *   x_axis = normalize(cross(up, z))  → eixo direito da câmera
 *   y_axis = cross(z, x)              → eixo para cima verdadeiro
 *
 * @param {number[3]} eye    — posição da câmera no mundo
 * @param {number[3]} center — ponto que a câmera está olhando
 * @param {number[3]} up     — direção "para cima" do mundo
 */
export function mat4LookAt(eye, center, up) {
  // z: da cena para a câmera
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  const zl = Math.hypot(zx, zy, zz);
  if (zl > 0) { zx /= zl; zy /= zl; zz /= zl; }

  // x: direita da câmera = cross(up, z)
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz);
  if (xl > 0) { xx /= xl; xy /= xl; xz /= xl; }

  // y: cima verdadeiro = cross(z, x)
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  // Monta a matriz view em column-major
  // As linhas da view matrix são os eixos da câmera expressos em coordenadas mundo.
  // A última coluna é a translação: -dot(eixo, eye).
  return new Float32Array([
    xx,  yx,  zx,  0,
    xy,  yy,  zy,  0,
    xz,  yz,  zz,  0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1
  ]);
}

/**
 * Monta a matriz TRS de um objeto: Translação × Rotação × Escala.
 *
 * Ordem de rotação Euler: Ry * Rx * Rz  (yaw → pitch → roll)
 * Isso significa: primeiro aplica Rz, depois Rx, depois Ry.
 *
 * @param {number} tx,ty,tz — translação
 * @param {number} rx,ry,rz — rotação em RADIANOS
 * @param {number} sx,sy,sz — escala
 */
export function mat4FromTRS(tx, ty, tz, rx, ry, rz, sx, sy, sz) {
  const cx  = Math.cos(rx), _sx = Math.sin(rx);
  const cy  = Math.cos(ry), _sy = Math.sin(ry);
  const cz  = Math.cos(rz), _sz = Math.sin(rz);

  // Matriz de rotação R = Ry * Rx * Rz (calculada analiticamente)
  const r00 =  cy * cz + _sy * _sx * _sz;
  const r10 =  cx * _sz;
  const r20 = -_sy * cz + cy * _sx * _sz;

  const r01 = -cy * _sz + _sy * _sx * cz;
  const r11 =  cx * cz;
  const r21 =  _sy * _sz + cy * _sx * cz;

  const r02 =  _sy * cx;
  const r12 = -_sx;
  const r22 =  cy * cx;

  // A matriz TRS em column-major:
  // Cada coluna de R é multiplicada pela escala correspondente.
  // A 4ª coluna é a translação.
  return new Float32Array([
    r00 * sx,  r10 * sx,  r20 * sx,  0,   // coluna 0
    r01 * sy,  r11 * sy,  r21 * sy,  0,   // coluna 1
    r02 * sz,  r12 * sz,  r22 * sz,  0,   // coluna 2
    tx,        ty,        tz,        1    // coluna 3 (translação)
  ]);
}
// Iago Kainan Bubolz Braatz

// MAT3 — Matriz 3×3 (usada para normais)
/**
 * Calcula a matriz de normais = transpose( inverse( 3×3 superior de m ) )
 *
 * Necessária para transformar normais corretamente quando há escala não-uniforme.
 * Sem isso, normais ficariam distorcidas e a iluminação seria errada.
 *
 * Retorna Float32Array(9) column-major para usar como uniform mat3.
 *
 * Derivação:
 *   inverse(A) = adjugate(A) / det(A)
 *   adjugate(A) = transpose( cofactor(A) )
 *   transpose(inverse(A)) = cofactor(A) / det(A)
 *   → a matriz normal é simplesmente a matriz de cofatores dividida pelo determinante.
 */
export function mat3NormalMatrix(m) {
  // Extrai a submatriz 3×3 superior esquerda da mat4 (column-major)
  // Notação a[linha][coluna] = m[coluna*4 + linha]
  const a00 = m[0],  a10 = m[1],  a20 = m[2];
  const a01 = m[4],  a11 = m[5],  a21 = m[6];
  const a02 = m[8],  a12 = m[9],  a22 = m[10];

  // Cofatores C[linha][coluna] = (-1)^(i+j) * det(menor ij)
  const C00 =  (a11 * a22 - a12 * a21);
  const C01 = -(a10 * a22 - a12 * a20);
  const C02 =  (a10 * a21 - a11 * a20);

  const C10 = -(a01 * a22 - a02 * a21);
  const C11 =  (a00 * a22 - a02 * a20);
  const C12 = -(a00 * a21 - a01 * a20);

  const C20 =  (a01 * a12 - a02 * a11);
  const C21 = -(a00 * a12 - a02 * a10);
  const C22 =  (a00 * a11 - a01 * a10);

  // Determinante expandido pela linha 0
  let det = a00 * C00 + a01 * C01 + a02 * C02;
  if (Math.abs(det) < 1e-10) det = 1; // evita divisão por zero

  const d = 1.0 / det;

  // Matriz normal = cofatores / det, armazenada column-major
  // out[col*3 + row] = C[row][col] / det
  return new Float32Array([
    C00 * d,  C10 * d,  C20 * d,   // coluna 0
    C01 * d,  C11 * d,  C21 * d,   // coluna 1
    C02 * d,  C12 * d,  C22 * d    // coluna 2
  ]);
}