/**
 * scene.js — Grafo de cena hierárquico
 *
 * Baseado no tutorial WebGL2 Scene Graphs:
 * https://webgl2fundamentals.org/webgl/lessons/webgl-scene-graph.html
 *
 * Conceitos-chave do tutorial aplicados aqui:
 *
 *  localMatrix  — matriz que descreve a posição/rotação/escala do nó
 *                 em relação ao seu pai (ou ao mundo, se for raiz).
 *
 *  worldMatrix  — resultado de:
 *                 worldMatrix = parentWorldMatrix * localMatrix
 *                 Posiciona o nó no espaço do mundo inteiro.
 *
 *  updateWorldMatrix(parentWorld) — percorre a árvore recursivamente,
 *                 calculando worldMatrix de cada nó a partir do pai.
 *
 * A origem do tutorial usa TRS como "source" separado do Node para
 * evitar acúmulo de erro. Aqui fazemos o mesmo: o Node guarda os
 * valores TRS brutos e reconstrói a localMatrix a cada frame.
 */

import { mat4Create, mat4Multiply, mat4FromTRS } from './math.js';

const DEG2RAD = Math.PI / 180;

// ─────────────────────────────────────────────────────────────
// CLASSE Node
// ─────────────────────────────────────────────────────────────

export class Node {
  /**
   * @param {string} modelName — nome do modelo OBJ a renderizar
   * @param {string} name      — nome de exibição no editor
   * @param {number} id        — identificador único (usado no picking)
   */
  constructor(modelName, name, id) {
    this.id        = id;
    this.modelName = modelName;
    this.name      = name;

    // ── TRS "source" (valores brutos, reconstruídos a cada frame) ──
    // Armazenamos graus para o editor de UI; convertemos para radianos
    // ao construir a matriz. Isso evita acúmulo de erro floating-point
    // que aconteceria se modificássemos a matriz diretamente.
    this.transform = {
      tx: 0, ty: 0, tz: 0,   // translação (unidades de mundo)
      rx: 0, ry: 0, rz: 0,   // rotação em GRAUS
      sx: 1, sy: 1, sz: 1    // escala
    };

    // ── Animação ──────────────────────────────────────────────────
    this.animation = {
      type:  'none',  // 'none' | 'rotate' | 'translate'
      axis:  'y',     // 'x' | 'y' | 'z'
      speed: 1.0      // rad/s (rotate) ou unidades/s (translate)
    };

    // ── Propriedades de textura ───────────────────────────────────────
    // tintR/G/B : multiplicador de cor aplicado à textura [0..1]
    // offsetU/V : deslocamento das coordenadas UV
    // scaleU/V  : escala das coordenadas UV
    this.texture = {
      tintR:   1.0,
      tintG:   1.0,
      tintB:   1.0,
      offsetU: 0.0,
      offsetV: 0.0,
      scaleU:  1.0,
      scaleV:  1.0
    };
    // Iago Kainan Bubolz Braatz


    // ── Estado de runtime da animação (não salvo no JSON) ─────────
    this._animAngle = 0;   // ângulo acumulado para animação de rotação
    this._animTime  = 0;   // tempo acumulado para animação de translação

    // ── Hierarquia ────────────────────────────────────────────────
    this.parent   = null;    // referência ao Node pai (ou null se raiz)
    this.children = [];      // array de Nodes filhos

    // ── Matrizes WebGL ────────────────────────────────────────────
    this.localMatrix = mat4Create();   // T*R*S local
    this.worldMatrix = mat4Create();   // pai.world * local
  }

  // ── Hierarquia ─────────────────────────────────────────────────

  /**
   * Define o pai deste nó.
   * Segue o padrão do tutorial: setParent em vez de addChild,
   * para evitar ambiguidade quando o nó já tem um pai.
   *
   * @param {Node|null} newParent
   */
  setParent(newParent) {
    // Remove do pai atual
    if (this.parent) {
      const idx = this.parent.children.indexOf(this);
      if (idx >= 0) this.parent.children.splice(idx, 1);
    }

    // Adiciona ao novo pai
    if (newParent) {
      // Proteção contra hierarquia circular
      if (this._isAncestorOf(newParent)) {
        console.warn('[scene] setParent: hierarquia circular bloqueada.');
        return;
      }
      newParent.children.push(this);
    }

    this.parent = newParent;
  }

  /**
   * Verifica se este nó é ancestral de outro (proteção circular).
   * @param {Node} other
   * @returns {boolean}
   */
  _isAncestorOf(other) {
    let current = other;
    while (current) {
      if (current === this) return true;
      current = current.parent;
    }
    return false;
  }

  // ── Matrizes ───────────────────────────────────────────────────

  /**
   * Reconstrói a localMatrix a partir dos valores TRS brutos,
   * aplicando os offsets de animação.
   *
   * Chamado antes de updateWorldMatrix a cada frame.
   */
  rebuildLocalMatrix() {
    let { tx, ty, tz, rx, ry, rz, sx, sy, sz } = this.transform;

    // Converte graus → radianos
    let rxr = rx * DEG2RAD;
    let ryr = ry * DEG2RAD;
    let rzr = rz * DEG2RAD;

    // Aplica offset de animação (não polui o transform salvo)
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

  /**
   * Calcula a worldMatrix deste nó e de todos os seus filhos.
   *
   * Diretamente do tutorial:
   *   worldMatrix = parentWorldMatrix * localMatrix
   *
   * @param {Float32Array|null} parentWorldMatrix — passada pelo pai
   */
  updateWorldMatrix(parentWorldMatrix) {
    if (parentWorldMatrix) {
      // Temos um pai: world = parent.world * local
      this.worldMatrix = mat4Multiply(parentWorldMatrix, this.localMatrix);
    } else {
      // Nó raiz: world = local  (copia a localMatrix)
      this.worldMatrix = new Float32Array(this.localMatrix);
    }

    // Propaga recursivamente para os filhos
    for (const child of this.children) {
      child.updateWorldMatrix(this.worldMatrix);
    }
  }

  /**
   * Avança o estado de animação deste nó (e filhos recursivamente).
   * @param {number} dt — delta time em segundos
   */
  updateAnimation(dt) {
    if (this.animation.type === 'rotate') {
      this._animAngle += this.animation.speed * dt;
    } else if (this.animation.type === 'translate') {
      this._animTime += dt;
    }

    // Propaga para filhos
    for (const child of this.children) {
      child.updateAnimation(dt);
    }
  }
}


// ─────────────────────────────────────────────────────────────
// CLASSE Scene
// ─────────────────────────────────────────────────────────────

export class Scene {
  constructor() {
    this._nodes  = [];    // lista plana de todos os nós
    this._nextId = 1;     // IDs começam em 1 (0 = "nada" no picking)
  }

  // ── CRUD de nós ────────────────────────────────────────────────

  /**
   * Adiciona um novo nó à cena.
   * @param {string} modelName — modelo OBJ a usar
   * @param {string} [name]    — nome de exibição
   * @returns {Node}
   */
  addNode(modelName, name) {
    const id    = this._nextId++;
    const label = name || `${modelName} #${id}`;
    const node  = new Node(modelName, label, id);
    this._nodes.push(node);
    return node;
  }

  /**
   * Remove um nó e todos os seus descendentes da cena.
   * Orphaniza os filhos diretos (sobe para null) antes de remover.
   * @param {number} id
   */
  removeNode(id) {
    const node = this.getNode(id);
    if (!node) return;

    // Coleta todos os descendentes para remover
    const toRemove = new Set();
    this._collectDescendants(node, toRemove);

    // Desconecta do pai
    node.setParent(null);

    // Remove da lista plana
    this._nodes = this._nodes.filter(n => !toRemove.has(n));
  }

  /** Coleta node e todos seus descendentes recursivamente */
  _collectDescendants(node, set) {
    set.add(node);
    for (const child of node.children) {
      this._collectDescendants(child, set);
    }
  }

  /**
   * Busca um nó pelo ID.
   * @param {number} id
   * @returns {Node|null}
   */
  getNode(id) {
    return this._nodes.find(n => n.id === id) ?? null;
  }

  /** Retorna todos os nós (ordem de inserção) */
  getAllNodes() {
    return this._nodes;
  }

  /** Retorna apenas os nós raiz (sem pai) */
  getRootNodes() {
    return this._nodes.filter(n => n.parent === null);
  }

  // ── Update a cada frame ────────────────────────────────────────

  /**
   * Atualiza animações e reconstrói todas as matrizes.
   * Chamado uma vez por frame no loop de renderização.
   *
   * Ordem:
   *  1. Avança animações (acumula _animAngle/_animTime)
   *  2. Reconstrói localMatrix de cada nó a partir dos TRS
   *  3. Percorre a árvore recalculando worldMatrix (raízes → filhos)
   *
   * @param {number} dt — delta time em segundos
   */
  update(dt) {
    // 1. Avança animações em todos os nós
    for (const node of this.getRootNodes()) {
      node.updateAnimation(dt);
    }

    // 2. Reconstrói localMatrix de TODOS os nós (flat, ordem não importa)
    for (const node of this._nodes) {
      node.rebuildLocalMatrix();
    }

    // 3. Recalcula worldMatrix a partir das raízes (propaga para filhos)
    for (const node of this.getRootNodes()) {
      node.updateWorldMatrix(null);
    }
  }

  // ── Serialização ───────────────────────────────────────────────

  /**
   * Exporta a cena como objeto JavaScript simples (para JSON).
   * Salva apenas dados, não referências WebGL nem estado de runtime.
   */
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

  /**
   * Reconstrói a cena a partir de um objeto JSON.
   * Restaura hierarquia usando os parentIds salvos.
   * @param {object} data — resultado de toJSON()
   */
  fromJSON(data) {
    // Limpa a cena atual
    this._nodes  = [];
    this._nextId = data.nextId ?? 1;

    // Cria todos os nós (sem hierarquia ainda)
    for (const nd of data.nodes) {
      const node = new Node(nd.modelName, nd.name, nd.id);
      Object.assign(node.transform, nd.transform);
      Object.assign(node.animation, nd.animation);
      // Valor padrão de textura para cenas salvas antes desta feature
      const defaultTexture = {
        tintR: 1, tintG: 1, tintB: 1,
        offsetU: 0, offsetV: 0,
        scaleU: 1, scaleV: 1
      };
      Object.assign(node.texture, nd.texture || defaultTexture);
      this._nodes.push(node);
    }

    // Reconstrói a hierarquia usando os parentIds
    for (const nd of data.nodes) {
      if (nd.parentId !== null) {
        const child  = this.getNode(nd.id);
        const parent = this.getNode(nd.parentId);
        if (child && parent) child.setParent(parent);
      }
    }

    // Calcula matrizes iniciais
    this.update(0);
  }
}