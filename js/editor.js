import { MODEL_LIST }                        from './loader.js';
import { saveSceneToFile, loadSceneFromFile } from './saveLoad.js';

function isDescendantOf(node, ancestor) {
  let current = node.parent;
  while (current !== null) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

export class Editor {

  constructor(scene, loader) {
    this.scene  = scene;
    this.loader = loader;

    this._selectedId = null;

    this._els = {};

    this._cacheElements();
    this._setupStaticEvents();

    this._setEditorEnabled(false);
  }

  _cacheElements() {
    const $ = id => document.getElementById(id);

    this._els = {
      sceneList:       $('scene-list'),
      btnDelete:       $('btn-delete'),
      btnSave:         $('btn-save'),
      btnLoad:         $('btn-load-json'),
      fileInput:       $('file-input'),
      selectedName:    $('selected-name'),
      transformEditor: $('transform-editor'),

      texTint:      $('tex-tint'),
      btnTintReset: $('btn-tint-reset'),
      texOffsetU:   $('tex-offset-u'),
      texOffsetV:   $('tex-offset-v'),
      texScaleU:    $('tex-scale-u'),
      texScaleV:    $('tex-scale-v'),

      tx: $('tx'),  ty: $('ty'),  tz: $('tz'),
      rx: $('rx'),  ry: $('ry'),  rz: $('rz'),
      sx: $('sx'),  sy: $('sy'),  sz: $('sz'),

      parentSelect: $('parent-select'),

      animType:  $('anim-type'),
      animAxis:  $('anim-axis'),
      animSpeed: $('anim-speed'),

      modelGrid: $('model-grid'),

      loadingOverlay: $('loading-overlay'),
      loadingText:    $('loading-text'),
    };
  }

  _setupStaticEvents() {
    const e = this._els;

    e.btnSave.addEventListener('click', () => {
      saveSceneToFile(this.scene);
    });

    e.btnLoad.addEventListener('click', () => {
      e.fileInput.click();
    });

    e.texTint.addEventListener('input',    () => this._onTextureInput());
    e.texOffsetU.addEventListener('input', () => this._onTextureInput());
    e.texOffsetV.addEventListener('input', () => this._onTextureInput());
    e.texScaleU.addEventListener('input',  () => this._onTextureInput());
    e.texScaleV.addEventListener('input',  () => this._onTextureInput());

    e.btnTintReset.addEventListener('click', () => {
      if (this._selectedId === null) return;
      const node = this.scene.getNode(this._selectedId);
      if (!node) return;
      node.texture.tintR = 1;
      node.texture.tintG = 1;
      node.texture.tintB = 1;
      e.texTint.value = '#ffffff';
    });

    e.fileInput.addEventListener('change', (evt) => {
      const file = evt.target.files[0];
      if (!file) return;

      loadSceneFromFile(file, this.scene, () => {
        this._selectedId = null;
        this.refreshSceneList();
        this._setEditorEnabled(false);
      });

      e.fileInput.value = '';
    });

    e.btnDelete.addEventListener('click', () => {
      if (this._selectedId === null) return;

      this.scene.removeNode(this._selectedId);
      this._selectedId = null;
      this.refreshSceneList();
      this._setEditorEnabled(false);
    });

    const trsIds = ['tx','ty','tz','rx','ry','rz','sx','sy','sz'];
    for (const id of trsIds) {
      e[id].addEventListener('input', () => this._onTransformInput());
    }

    e.parentSelect.addEventListener('change', () => this._onParentChange());

    e.animType.addEventListener('change', () => this._onAnimationInput());
    e.animAxis.addEventListener('change', () => this._onAnimationInput());
    e.animSpeed.addEventListener('input',  () => this._onAnimationInput());
  }

  buildModelPanel(thumbnails) {
    const grid = this._els.modelGrid;
    grid.innerHTML = '';

    for (const modelInfo of MODEL_LIST) {
      if (!this.loader.getModel(modelInfo.name)) continue;

      const item      = document.createElement('div');
      item.className  = 'model-item';
      item.dataset.model = modelInfo.name;
      item.title      = `Adicionar: ${modelInfo.label}`;

      const img    = document.createElement('img');
      img.src      = thumbnails[modelInfo.name] || '';
      img.alt      = modelInfo.label;
      img.draggable = false;

      const lbl       = document.createElement('span');
      lbl.className   = 'model-label';
      lbl.textContent = modelInfo.label;

      item.appendChild(img);
      item.appendChild(lbl);

      item.addEventListener('click', () => {
        const node = this.scene.addNode(modelInfo.name);
        this._selectedId = node.id;
        this.refreshSceneList();
        this.selectNode(node.id);
      });

      grid.appendChild(item);
    }
  }

  refreshSceneList() {
    const list = this._els.sceneList;
    list.innerHTML = '';

    const orderedItems = this._getDFSOrder();

    if (orderedItems.length === 0) {
      list.innerHTML =
        '<div class="scene-empty">Cena vazia.<br>Clique num modelo →</div>';
      this._els.btnDelete.disabled = true;
      return;
    }

    for (const { node, depth } of orderedItems) {
      const item      = document.createElement('div');
      item.className  = 'scene-item';
      item.dataset.id = node.id;

      if (node.id === this._selectedId) {
        item.classList.add('selected');
      }

      item.style.paddingLeft = `${depth * 16 + 8}px`;

      const isChild   = depth > 0;
      const hasChildren = node.children.length > 0;

      const animBadge  = node.animation.type !== 'none' ? ' <span class="badge anim-badge" title="Animação ativa">⟳</span>' : '';
      const childBadge = hasChildren ? ' <span class="badge child-badge" title="Tem filhos">▾</span>' : '';
      const prefix     = isChild ? '<span class="scene-prefix">└─</span> ' : '';

      item.innerHTML =
        `${prefix}` +
        `<span class="scene-label">${_escapeHtml(node.name)}</span>` +
        `${animBadge}${childBadge}`;

      item.addEventListener('click', () => {
        this.selectNode(node.id);
      });

      list.appendChild(item);
    }
  }

  _getDFSOrder() {
    const result = [];

    const traverse = (node, depth) => {
      result.push({ node, depth });
      for (const child of node.children) {
        traverse(child, depth + 1);
      }
    };

    for (const root of this.scene.getRootNodes()) {
      traverse(root, 0);
    }

    return result;
  }

  selectNode(id) {
    this._selectedId = id;

    this._updateListHighlight();

    const node = id !== null ? this.scene.getNode(id) : null;

    if (node) {
      this._els.selectedName.textContent = node.name;

      this._setEditorEnabled(true);

      this._fillInputs(node);

      this._els.btnDelete.disabled = false;

    } else {
      this._els.selectedName.textContent = '—';
      this._setEditorEnabled(false);
      this._els.btnDelete.disabled = true;
    }
  }

  getSelectedId() {
    return this._selectedId;
  }

  _updateListHighlight() {
    const items = this._els.sceneList.querySelectorAll('.scene-item');
    for (const item of items) {
      const itemId = parseInt(item.dataset.id, 10);
      item.classList.toggle('selected', itemId === this._selectedId);
    }
  }

  _fillInputs(node) {
    const e = this._els;
    const t = node.transform;

    e.tx.value = +t.tx.toFixed(4);
    e.ty.value = +t.ty.toFixed(4);
    e.tz.value = +t.tz.toFixed(4);

    e.rx.value = +t.rx.toFixed(4);
    e.ry.value = +t.ry.toFixed(4);
    e.rz.value = +t.rz.toFixed(4);

    e.sx.value = +t.sx.toFixed(4);
    e.sy.value = +t.sy.toFixed(4);
    e.sz.value = +t.sz.toFixed(4);

    e.animType.value  = node.animation.type;
    e.animAxis.value  = node.animation.axis;
    e.animSpeed.value = +node.animation.speed.toFixed(4);

    const tex = node.texture;

    const toHex = v => Math.round(Math.max(0, Math.min(1, v)) * 255)
                           .toString(16).padStart(2, '0');
    e.texTint.value    = `#${toHex(tex.tintR)}${toHex(tex.tintG)}${toHex(tex.tintB)}`;

    e.texOffsetU.value = +tex.offsetU.toFixed(4);
    e.texOffsetV.value = +tex.offsetV.toFixed(4);
    e.texScaleU.value  = +tex.scaleU.toFixed(4);
    e.texScaleV.value  = +tex.scaleV.toFixed(4);

    this._refreshParentDropdown(node);
  }

  _onTransformInput() {
    if (this._selectedId === null) return;
    const node = this.scene.getNode(this._selectedId);
    if (!node) return;

    const e = this._els;
    const t = node.transform;

    const read = (input, fallback) => {
      const v = parseFloat(input.value);
      return isNaN(v) ? fallback : v;
    };

    t.tx = read(e.tx, t.tx);
    t.ty = read(e.ty, t.ty);
    t.tz = read(e.tz, t.tz);

    t.rx = read(e.rx, t.rx);
    t.ry = read(e.ry, t.ry);
    t.rz = read(e.rz, t.rz);

    t.sx = Math.max(0.001, read(e.sx, t.sx));
    t.sy = Math.max(0.001, read(e.sy, t.sy));
    t.sz = Math.max(0.001, read(e.sz, t.sz));
  }

  _refreshParentDropdown(selectedNode) {
    const sel = this._els.parentSelect;

    sel.innerHTML = '<option value="">— Nenhum (Raiz) —</option>';

    for (const node of this.scene.getAllNodes()) {
      if (node.id === selectedNode.id) continue;

      if (isDescendantOf(node, selectedNode)) continue;

      const opt       = document.createElement('option');
      opt.value       = node.id;
      opt.textContent = node.name;

      if (selectedNode.parent && selectedNode.parent.id === node.id) {
        opt.selected = true;
      }

      sel.appendChild(opt);
    }
  }

  _onParentChange() {
    if (this._selectedId === null) return;
    const node = this.scene.getNode(this._selectedId);
    if (!node) return;

    const rawValue = this._els.parentSelect.value;
    const parentId = rawValue ? parseInt(rawValue, 10) : null;

    if (parentId === null) {
      node.setParent(null);
    } else {
      const parent = this.scene.getNode(parentId);
      if (parent) node.setParent(parent);
    }

    this.refreshSceneList();
  }

  _onAnimationInput() {
    if (this._selectedId === null) return;
    const node = this.scene.getNode(this._selectedId);
    if (!node) return;

    const e        = this._els;
    const prevType = node.animation.type;

    node.animation.type  = e.animType.value;
    node.animation.axis  = e.animAxis.value;
    node.animation.speed = Math.max(0, parseFloat(e.animSpeed.value) || 1.0);

    if (node.animation.type !== prevType) {
      node._animAngle = 0;
      node._animTime  = 0;
    }

    this.refreshSceneList();
  }

  _onTextureInput() {
    if (this._selectedId === null) return;
    const node = this.scene.getNode(this._selectedId);
    if (!node) return;

    const e   = this._els;
    const tex = node.texture;

    const hex = e.texTint.value.replace('#', '');
    tex.tintR = parseInt(hex.slice(0, 2), 16) / 255;
    tex.tintG = parseInt(hex.slice(2, 4), 16) / 255;
    tex.tintB = parseInt(hex.slice(4, 6), 16) / 255;

    const read = (input, fallback) => {
      const v = parseFloat(input.value);
      return isNaN(v) ? fallback : v;
    };

    tex.offsetU = read(e.texOffsetU, tex.offsetU);
    tex.offsetV = read(e.texOffsetV, tex.offsetV);
    tex.scaleU  = Math.max(0.001, read(e.texScaleU, tex.scaleU));
    tex.scaleV  = Math.max(0.001, read(e.texScaleV, tex.scaleV));
  }

  _setEditorEnabled(enabled) {
    const section = this._els.transformEditor;
    if (!section) return;

    if (enabled) {
      section.classList.remove('disabled-section');
    } else {
      section.classList.add('disabled-section');
    }

    section.querySelectorAll('input, select').forEach(el => {
      el.disabled = !enabled;
    });
  }

  setLoadingProgress(loaded, total) {
    const overlay = this._els.loadingOverlay;
    const text    = this._els.loadingText;
    if (!overlay || !text) return;

    if (loaded >= total) {
      overlay.style.transition    = 'opacity 0.4s ease';
      overlay.style.opacity       = '0';
      overlay.style.pointerEvents = 'none';
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 450);
    } else {
      const pct = Math.round((loaded / total) * 100);
      text.textContent = `Carregando modelos… ${loaded} / ${total}  (${pct}%)`;

      const bar = document.getElementById('loading-bar');
      if (bar) bar.style.width = `${pct}%`;
    }
  }
}

function _escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}