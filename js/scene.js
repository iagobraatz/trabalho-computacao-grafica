import { mat4Create, mat4Multiply, mat4FromTRS } from './math.js';

const DEG2RAD = Math.PI / 180;

export class Node {
  constructor(modelName, name, id) {
    this.id        = id;
    this.modelName = modelName;
    this.name      = name;

    this.transform = {
      tx: 0, ty: 0, tz: 0,
      rx: 0, ry: 0, rz: 0,
      sx: 1, sy: 1, sz: 1
    };

    this.animation = {
      type:  'none',  
      axis:  'y',    
      speed: 1.0     
    };

    this.texture = {
      tintR:   1.0,
      tintG:   1.0,
      tintB:   1.0,
      offsetU: 0.0,
      offsetV: 0.0,
      scaleU:  1.0,
      scaleV:  1.0
    };

    this._animAngle = 0;
    this._animTime  = 0;

    this.parent   = null;
    this.children = [];

    this.localMatrix = mat4Create();
    this.worldMatrix = mat4Create();
  }

  setParent(newParent) {
    if (this.parent) {
      const idx = this.parent.children.indexOf(this);
      if (idx >= 0) this.parent.children.splice(idx, 1);
    }

    if (newParent) {
      if (this._isAncestorOf(newParent)) {
        console.warn('[scene] setParent: hierarquia circular bloqueada.');
        return;
      }
      newParent.children.push(this);
    }

    this.parent = newParent;
  }

  _isAncestorOf(other) {
    let current = other;
    while (current) {
      if (current === this) return true;
      current = current.parent;
    }
    return false;
  }

  rebuildLocalMatrix() {
    let { tx, ty, tz, rx, ry, rz, sx, sy, sz } = this.transform;

    let rxr = rx * DEG2RAD;
    let ryr = ry * DEG2RAD;
    let rzr = rz * DEG2RAD;

    if (this.animation.type === 'rotate') {
      if      (this.animation.axis === 'x') rxr += this._animAngle;
      else if (this.animation.axis === 'y') ryr += this._animAngle;
      else if (this.animation.axis === 'z') rzr += this._animAngle;
    }

    if (this.animation.type === 'translate') {
      const offset = Math.sin(this._animTime) * this.animation.speed;
      if      (this.animation.axis === 'x') tx += offset;
      else if (this.animation.axis === 'y') ty += offset;
      else if (this.animation.axis === 'z') tz += offset;
    }

    this.localMatrix = mat4FromTRS(tx, ty, tz, rxr, ryr, rzr, sx, sy, sz);
  }

  updateWorldMatrix(parentWorldMatrix) {
    if (parentWorldMatrix) {
      this.worldMatrix = mat4Multiply(parentWorldMatrix, this.localMatrix);
    } else {
      this.worldMatrix = new Float32Array(this.localMatrix);
    }

    for (const child of this.children) {
      child.updateWorldMatrix(this.worldMatrix);
    }
  }

  updateAnimation(dt) {
    if (this.animation.type === 'rotate') {
      this._animAngle += this.animation.speed * dt;
    } else if (this.animation.type === 'translate') {
      this._animTime += dt;
    }

    for (const child of this.children) {
      child.updateAnimation(dt);
    }
  }
}

export class Scene {
  constructor() {
    this._nodes  = [];   
    this._nextId = 1;    
  }

  addNode(modelName, name) {
    const id    = this._nextId++;
    const label = name || `${modelName} #${id}`;
    const node  = new Node(modelName, label, id);
    this._nodes.push(node);
    return node;
  }

  removeNode(id) {
    const node = this.getNode(id);
    if (!node) return;

    const toRemove = new Set();
    this._collectDescendants(node, toRemove);

    node.setParent(null);

    this._nodes = this._nodes.filter(n => !toRemove.has(n));
  }

  _collectDescendants(node, set) {
    set.add(node);
    for (const child of node.children) {
      this._collectDescendants(child, set);
    }
  }

  getNode(id) {
    return this._nodes.find(n => n.id === id) ?? null;
  }

  getAllNodes() {
    return this._nodes;
  }

  getRootNodes() {
    return this._nodes.filter(n => n.parent === null);
  }

  update(dt) {
    for (const node of this.getRootNodes()) {
      node.updateAnimation(dt);
    }

    for (const node of this._nodes) {
      node.rebuildLocalMatrix();
    }

    for (const node of this.getRootNodes()) {
      node.updateWorldMatrix(null);
    }
  }

  toJSON() {
    return {
      nextId: this._nextId,
      nodes: this._nodes.map(n => ({
        id:        n.id,
        modelName: n.modelName,
        name:      n.name,
        parentId:  n.parent ? n.parent.id : null,
        transform: { ...n.transform },
        animation: { ...n.animation },
        texture:   { ...n.texture }
      }))
    };
  }

  fromJSON(data) {
    this._nodes  = [];
    this._nextId = data.nextId ?? 1;

    for (const nd of data.nodes) {
      const node = new Node(nd.modelName, nd.name, nd.id);
      Object.assign(node.transform, nd.transform);
      Object.assign(node.animation, nd.animation);
      const defaultTexture = {
        tintR: 1, tintG: 1, tintB: 1,
        offsetU: 0, offsetV: 0,
        scaleU: 1, scaleV: 1
      };
      Object.assign(node.texture, nd.texture || defaultTexture);
      this._nodes.push(node);
    }

    for (const nd of data.nodes) {
      if (nd.parentId !== null) {
        const child  = this.getNode(nd.id);
        const parent = this.getNode(nd.parentId);
        if (child && parent) child.setParent(parent);
      }
    }

    this.update(0);
  }
}