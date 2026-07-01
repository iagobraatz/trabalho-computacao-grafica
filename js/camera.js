import { mat4LookAt, mat4Perspective } from './math.js';

const DEG2RAD = Math.PI / 180;

export class Camera {

  constructor(canvas) {
    this.canvas = canvas;
    this.azimuth   = 45;
    this.elevation = 30;
    this.distance  = 15;

    this.target = [0, 0, 0];

    this.fovY = 45 * DEG2RAD;
    this.near = 0.1;
    this.far  = 1000;

    this._isDragging  = false;
    this._lastMouseX  = 0;
    this._lastMouseY  = 0;
    this._mouseButton = -1;

    this.orbitSensitivity = 0.4;

    this._setupEvents();
  }

  getEye() {
    const az    = this.azimuth   * DEG2RAD;
    const el    = this.elevation * DEG2RAD;
    const cosEl = Math.cos(el);
    return [
      this.target[0] + this.distance * cosEl * Math.sin(az),
      this.target[1] + this.distance * Math.sin(el),
      this.target[2] + this.distance * cosEl * Math.cos(az)
    ];
  }

  getViewMatrix() {
    return mat4LookAt(
      this.getEye(),
      this.target,
      [0, 1, 0]
    );
  }

  getProjectionMatrix(aspect) {
    return mat4Perspective(this.fovY, aspect, this.near, this.far);
  }

  orbit(dAz, dEl) {
    this.azimuth   -= dAz;
    this.elevation  = Math.max(-85, Math.min(85, this.elevation + dEl));
  }

  pan(dx, dy) {
    const view = this.getViewMatrix();

    const right = [view[0], view[4], view[8]];
    const up    = [view[1], view[5], view[9]];

    const worldHeight = 2 * this.distance * Math.tan(this.fovY * 0.5);
    const pixelSize   = worldHeight / this.canvas.clientHeight;

    this.target[0] += (-dx * right[0] + dy * up[0]) * pixelSize;
    this.target[1] += (-dx * right[1] + dy * up[1]) * pixelSize;
    this.target[2] += (-dx * right[2] + dy * up[2]) * pixelSize;
  }

  zoom(deltaY) {
    const normalized = Math.sign(deltaY) * Math.min(Math.abs(deltaY), 120);

    const factor = 1 + normalized * 0.001;

    this.distance = Math.max(0.5, Math.min(500, this.distance * factor));
  }

  _setupEvents() {
    const canvas = this.canvas;

    canvas.addEventListener('mousedown', (e) => {
      this._isDragging  = true;
      this._lastMouseX  = e.clientX;
      this._lastMouseY  = e.clientY;
      this._mouseButton = e.button;

      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this._isDragging) return;

      const dx = e.clientX - this._lastMouseX;
      const dy = e.clientY - this._lastMouseY;

      this._lastMouseX = e.clientX;
      this._lastMouseY = e.clientY;

      if (dx === 0 && dy === 0) return;

      const isPan = e.shiftKey || this._mouseButton === 2;

      if (isPan) {
        this.pan(dx, dy);
      } else if (this._mouseButton === 0) {
        this.orbit(
          dx * this.orbitSensitivity,
          dy * this.orbitSensitivity
        );
      }
    });

    window.addEventListener('mouseup', () => {
      this._isDragging  = false;
      this._mouseButton = -1;
    });

    canvas.addEventListener('wheel', (e) => {
      this.zoom(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }

  get isDragging() {
    return this._isDragging;
  }

  reset() {
    this.azimuth   = 45;
    this.elevation = 30;
    this.distance  = 15;
    this.target    = [0, 0, 0];
  }
}