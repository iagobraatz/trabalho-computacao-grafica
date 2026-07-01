export function mat4Create() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ]);
}

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

export function mat4LookAt(eye, center, up) {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  const zl = Math.hypot(zx, zy, zz);
  if (zl > 0) { zx /= zl; zy /= zl; zz /= zl; }

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz);
  if (xl > 0) { xx /= xl; xy /= xl; xz /= xl; }

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

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

export function mat4FromTRS(tx, ty, tz, rx, ry, rz, sx, sy, sz) {
  const cx  = Math.cos(rx), _sx = Math.sin(rx);
  const cy  = Math.cos(ry), _sy = Math.sin(ry);
  const cz  = Math.cos(rz), _sz = Math.sin(rz);

  const r00 =  cy * cz + _sy * _sx * _sz;
  const r10 =  cx * _sz;
  const r20 = -_sy * cz + cy * _sx * _sz;

  const r01 = -cy * _sz + _sy * _sx * cz;
  const r11 =  cx * cz;
  const r21 =  _sy * _sz + cy * _sx * cz;

  const r02 =  _sy * cx;
  const r12 = -_sx;
  const r22 =  cy * cx;

  return new Float32Array([
    r00 * sx,  r10 * sx,  r20 * sx,  0,
    r01 * sy,  r11 * sy,  r21 * sy,  0,
    r02 * sz,  r12 * sz,  r22 * sz,  0,
    tx,        ty,        tz,        1
  ]);
}

export function mat3NormalMatrix(m) {
  const a00 = m[0],  a10 = m[1],  a20 = m[2];
  const a01 = m[4],  a11 = m[5],  a21 = m[6];
  const a02 = m[8],  a12 = m[9],  a22 = m[10];

  const C00 =  (a11 * a22 - a12 * a21);
  const C01 = -(a10 * a22 - a12 * a20);
  const C02 =  (a10 * a21 - a11 * a20);

  const C10 = -(a01 * a22 - a02 * a21);
  const C11 =  (a00 * a22 - a02 * a20);
  const C12 = -(a00 * a21 - a01 * a20);

  const C20 =  (a01 * a12 - a02 * a11);
  const C21 = -(a00 * a12 - a02 * a10);
  const C22 =  (a00 * a11 - a01 * a10);

  let det = a00 * C00 + a01 * C01 + a02 * C02;
  if (Math.abs(det) < 1e-10) det = 1;

  const d = 1.0 / det;

  return new Float32Array([
    C00 * d,  C10 * d,  C20 * d,
    C01 * d,  C11 * d,  C21 * d,
    C02 * d,  C12 * d,  C22 * d
  ]);
}