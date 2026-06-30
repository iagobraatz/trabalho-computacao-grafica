/**
 * editor.js — Gerenciador da UI do editor de cena 3D
 *
 * Responsabilidades:
 *  1. Painel direito : grid de miniaturas dos modelos disponíveis
 *  2. Painel esquerdo: lista hierárquica (DFS) dos objetos na cena
 *  3. Editor de transformações TRS do objeto selecionado
 *  4. Editor de animação
 *  5. Controle de hierarquia via dropdown de pai
 *  6. Integração com save/load (delega para saveLoad.js)
 *
 * Relação com outros módulos:
 *  ─ Não conhece WebGL. Manipula apenas Scene e DOM.
 *  ─ main.js chama editor.selectNode(id) quando picking detecta clique 3D.
 *  ─ main.js lê editor.getSelectedId() a cada frame para destacar objeto.
 *  ─ main.js chama editor.setLoadingProgress() durante a inicialização.
 */

import { MODEL_LIST }                        from './loader.js';
import { saveSceneToFile, loadSceneFromFile } from './saveLoad.js';

// ─────────────────────────────────────────────────────────────────────────────
// UTILITÁRIO LOCAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifica se `node` é descendente de `ancestor`.
 * Sobe a cadeia de pais até chegar à raiz ou encontrar `ancestor`.
 *
 * Usado no dropdown de pai para evitar hierarquias circulares:
 *   se A é pai de B, B não pode virar pai de A.
 *
 * @param {Node} node
 * @param {Node} ancestor
 * @returns {boolean}
 */
function isDescendantOf(node, ancestor) {
  let current = node.parent;
  while (current !== null) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSE Editor
// ─────────────────────────────────────────────────────────────────────────────

export class Editor {

  /**
   * @param {Scene}       scene  — instância do grafo de cena
   * @param {ModelLoader} loader — para verificar quais modelos carregaram
   */
  constructor(scene, loader) {
    this.scene  = scene;
    this.loader = loader;

    // ID do nó selecionado. null = nenhum.
    // 0 é reservado para "fundo" no sistema de picking por cor do main.js.
    this._selectedId = null;

    // Cache de elementos DOM (evita getElementById repetido)
    this._els = {};

    this._cacheElements();
    this._setupStaticEvents();

    // Começa com painel de edição desabilitado (nenhum objeto selecionado)
    this._setEditorEnabled(false);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // INICIALIZAÇÃO
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Armazena referências a todos os elementos DOM usados pelo editor.
   * Chamado uma única vez no construtor.
   * Muito mais eficiente do que chamar getElementById a cada atualização.
   */
  _cacheElements() {
    const $ = id => document.getElementById(id);

    this._els = {
      // ── Painel esquerdo ──────────────────────────────────────────
      sceneList:       $('scene-list'),
      btnDelete:       $('btn-delete'),
      btnSave:         $('btn-save'),
      btnLoad:         $('btn-load-json'),
      fileInput:       $('file-input'),
      selectedName:    $('selected-name'),
      transformEditor: $('transform-editor'),

      // ── Textura ──────────────────────────────────────────────────
      texTint:      $('tex-tint'),
      btnTintReset: $('btn-tint-reset'),
      texOffsetU:   $('tex-offset-u'),
      texOffsetV:   $('tex-offset-v'),
      texScaleU:    $('tex-scale-u'),
      texScaleV:    $('tex-scale-v'),

      // ── Inputs de transformação (TRS) ────────────────────────────
      tx: $('tx'),  ty: $('ty'),  tz: $('tz'),
      rx: $('rx'),  ry: $('ry'),  rz: $('rz'),
      sx: $('sx'),  sy: $('sy'),  sz: $('sz'),

      // ── Hierarquia ───────────────────────────────────────────────
      parentSelect: $('parent-select'),

      // ── Animação ────────────────────────────────────────────────
      animType:  $('anim-type'),
      animAxis:  $('anim-axis'),
      animSpeed: $('anim-speed'),

      // ── Painel direito ───────────────────────────────────────────
      modelGrid: $('model-grid'),

      // ── Overlay de carregamento ──────────────────────────────────
      loadingOverlay: $('loading-overlay'),
      loadingText:    $('loading-text'),
    };
  }

  /**
   * Configura os event listeners permanentes da UI.
   *
   * Listeners dos itens da lista de cena NÃO ficam aqui — eles são
   * recriados em refreshSceneList() toda vez que a lista é reconstruída.
   */
  _setupStaticEvents() {
    const e = this._els;

    // ── Salvar ──────────────────────────────────────────────────────
    e.btnSave.addEventListener('click', () => {
      saveSceneToFile(this.scene);
    });

    // ── Carregar ────────────────────────────────────────────────────
    e.btnLoad.addEventListener('click', () => {
      // Abre o seletor de arquivo nativo do browser
      e.fileInput.click();
    });

    // ── Textura ──────────────────────────────────────────────────────
    e.texTint.addEventListener('input',    () => this._onTextureInput());
    e.texOffsetU.addEventListener('input', () => this._onTextureInput());
    e.texOffsetV.addEventListener('input', () => this._onTextureInput());
    e.texScaleU.addEventListener('input',  () => this._onTextureInput());
    e.texScaleV.addEventListener('input',  () => this._onTextureInput());

    // Botão de reset do tint para branco (#ffffff)
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
        // Callback chamado após o JSON ser aplicado à cena
        this._selectedId = null;
        this.refreshSceneList();
        this._setEditorEnabled(false);
      });

      // Limpa o input para permitir carregar o mesmo arquivo novamente
      e.fileInput.value = '';
    });

    // ── Deletar nó selecionado ──────────────────────────────────────
    e.btnDelete.addEventListener('click', () => {
      if (this._selectedId === null) return;

      // removeNode já trata filhos (veja scene.js)
      this.scene.removeNode(this._selectedId);
      this._selectedId = null;
      this.refreshSceneList();
      this._setEditorEnabled(false);
    });

    // ── Inputs de transformação TRS ─────────────────────────────────
    // Usa evento 'input' (dispara enquanto digita) para resposta imediata.
    // O parsing com fallback em _onTransformInput() garante que campos
    // vazios ou parcialmente digitados não quebrem a cena.
    const trsIds = ['tx','ty','tz','rx','ry','rz','sx','sy','sz'];
    for (const id of trsIds) {
      e[id].addEventListener('input', () => this._onTransformInput());
    }

    // ── Hierarquia: dropdown de pai ─────────────────────────────────
    e.parentSelect.addEventListener('change', () => this._onParentChange());

    // ── Animação ────────────────────────────────────────────────────
    e.animType.addEventListener('change', () => this._onAnimationInput());
    e.animAxis.addEventListener('change', () => this._onAnimationInput());
    e.animSpeed.addEventListener('input',  () => this._onAnimationInput());
  }
  // PAINEL DIREITO — Grid de miniaturas dos modelos
  /**
   * Constrói o grid de modelos disponíveis no painel direito.
   * Chamado UMA VEZ em main.js após todos os modelos e thumbnails
   * estarem prontos.
   *
   * Cada item do grid exibe:
   *  ─ Uma imagem estática (thumbnail 3D renderizado para data URL)
   *  ─ O label do modelo
   *
   * Clique → adiciona o modelo ao centro da cena e o seleciona.
   *
   * @param {Object} thumbnails — { nomeDotModelo: dataURL, ... }
   */
  buildModelPanel(thumbnails) {
    const grid = this._els.modelGrid;
    grid.innerHTML = '';

    for (const modelInfo of MODEL_LIST) {
      // Só exibe modelos que foram carregados com sucesso
      if (!this.loader.getModel(modelInfo.name)) continue;

      // Cria o item do grid
      const item      = document.createElement('div');
      item.className  = 'model-item';
      item.dataset.model = modelInfo.name;
      item.title      = `Adicionar: ${modelInfo.label}`;

      // Imagem: thumbnail 3D renderizado por main.js
      const img    = document.createElement('img');
      img.src      = thumbnails[modelInfo.name] || '';
      img.alt      = modelInfo.label;
      img.draggable = false;

      // Label de texto abaixo da miniatura
      const lbl       = document.createElement('span');
      lbl.className   = 'model-label';
      lbl.textContent = modelInfo.label;

      item.appendChild(img);
      item.appendChild(lbl);

      // Clique → adiciona à cena e seleciona o novo nó
      item.addEventListener('click', () => {
        const node = this.scene.addNode(modelInfo.name);
        // Seleciona antes de refreshSceneList para que a lista
        // já renderize com o item correto marcado como 'selected'
        this._selectedId = node.id;
        this.refreshSceneList();
        this.selectNode(node.id);
      });

      grid.appendChild(item);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PAINEL ESQUERDO — Lista de objetos na cena
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Reconstrói a lista visual de todos os objetos na cena.
   *
   * Percorre a cena em DFS (Depth-First Search) a partir das raízes:
   *
   *   raiz         (depth 0, padding base)
   *   └─ filho     (depth 1, +16px)
   *      └─ neto   (depth 2, +32px)
   *
   * Cada item da lista:
   *  ─ Mostra o nome do nó
   *  ─ Tem indentação proporcional à profundidade
   *  ─ Marca o nó selecionado com a classe CSS 'selected'
   *  ─ Exibe ⟳ se tiver animação ativa
   *  ─ Exibe ▾ se tiver filhos
   *
   * Chamado sempre que a composição da cena muda.
   */
  refreshSceneList() {
    const list = this._els.sceneList;
    list.innerHTML = '';

    // Gera a lista ordenada em DFS
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

      // Destaca o nó atualmente selecionado
      if (node.id === this._selectedId) {
        item.classList.add('selected');
      }

      // Indentação hierárquica: 16px por nível + 8px de margem inicial
      item.style.paddingLeft = `${depth * 16 + 8}px`;

      // Prefixo visual para indicar posição na hierarquia
      const isChild   = depth > 0;
      const hasChildren = node.children.length > 0;

      // Ícones de estado
      const animBadge  = node.animation.type !== 'none' ? ' <span class="badge anim-badge" title="Animação ativa">⟳</span>' : '';
      const childBadge = hasChildren ? ' <span class="badge child-badge" title="Tem filhos">▾</span>' : '';
      const prefix     = isChild ? '<span class="scene-prefix">└─</span> ' : '';

      item.innerHTML =
        `${prefix}` +
        `<span class="scene-label">${_escapeHtml(node.name)}</span>` +
        `${animBadge}${childBadge}`;

      // Clique na lista → seleciona o nó
      item.addEventListener('click', () => {
        this.selectNode(node.id);
      });

      list.appendChild(item);
    }
  }

  /**
   * Gera a lista de nós em ordem DFS para exibição hierárquica.
   * Começa pelas raízes (nós sem pai) e desce recursivamente.
   *
   * @returns {{ node: Node, depth: number }[]}
   */
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
  // SELEÇÃO
  /**
   * Seleciona um nó pelo ID e sincroniza toda a UI.
   *
   * Chamado por:
   *  ─ Clique num item da lista de cena (painel esquerdo)
   *  ─ Clique num modelo no painel de miniaturas (painel direito)
   *  ─ main.js, quando o picking 3D detecta um objeto clicado no canvas
   *  ─ null, para desselecionar tudo
   *
   * @param {number|null} id
   */
  selectNode(id) {
    this._selectedId = id;

    this._updateListHighlight();

    const node = id !== null ? this.scene.getNode(id) : null;

    if (node) {
      // Mostra nome no cabeçalho das propriedades
      this._els.selectedName.textContent = node.name;

      // Habilita todos os controles de edição
      this._setEditorEnabled(true);

      // Preenche os inputs com os valores do nó
      this._fillInputs(node);

      // Habilita o botão deletar
      this._els.btnDelete.disabled = false;

    } else {
      // Sem seleção: desabilita tudo
      this._els.selectedName.textContent = '—';
      this._setEditorEnabled(false);
      this._els.btnDelete.disabled = true;
    }
  }

  /**
   * Retorna o ID do nó selecionado.
   * Chamado por main.js a cada frame para destacar o objeto no WebGL.
   * @returns {number|null}
   */
  getSelectedId() {
    return this._selectedId;
  }

  /**
   * Atualiza apenas a classe CSS 'selected' nos itens da lista.
   * NÃO reconstrói o DOM — apenas toggle da classe.
   * Muito mais rápido que refreshSceneList() para trocas de seleção.
   */
  _updateListHighlight() {
    const items = this._els.sceneList.querySelectorAll('.scene-item');
    for (const item of items) {
      const itemId = parseInt(item.dataset.id, 10);
      item.classList.toggle('selected', itemId === this._selectedId);
    }
  }
  // PREENCHER E LER INPUTS
  /**
   * Preenche todos os inputs com os valores do nó selecionado.
   * Chamado sempre que a seleção muda.
   *
   * toFixed(4) evita notação científica (ex: 1.2e-7).
   * O `+` na frente remove zeros desnecessários (0.1000 → 0.1).
   *
   * @param {Node} node
   */
  _fillInputs(node) {
    const e = this._els;
    const t = node.transform;

    // Translação
    e.tx.value = +t.tx.toFixed(4);
    e.ty.value = +t.ty.toFixed(4);
    e.tz.value = +t.tz.toFixed(4);

    // Rotação (em graus, como armazenado no transform)
    e.rx.value = +t.rx.toFixed(4);
    e.ry.value = +t.ry.toFixed(4);
    e.rz.value = +t.rz.toFixed(4);

    // Escala
    e.sx.value = +t.sx.toFixed(4);
    e.sy.value = +t.sy.toFixed(4);
    e.sz.value = +t.sz.toFixed(4);

    // Animação
    e.animType.value  = node.animation.type;
    e.animAxis.value  = node.animation.axis;
    e.animSpeed.value = +node.animation.speed.toFixed(4);

    // ── Textura ──────────────────────────────────────────────────
    const tex = node.texture;

    // Converte RGB [0..1] → string hex "#rrggbb" para o color picker
    const toHex = v => Math.round(Math.max(0, Math.min(1, v)) * 255)
                           .toString(16).padStart(2, '0');
    e.texTint.value    = `#${toHex(tex.tintR)}${toHex(tex.tintG)}${toHex(tex.tintB)}`;

    e.texOffsetU.value = +tex.offsetU.toFixed(4);
    e.texOffsetV.value = +tex.offsetV.toFixed(4);
    e.texScaleU.value  = +tex.scaleU.toFixed(4);
    e.texScaleV.value  = +tex.scaleV.toFixed(4);

    // Reconstrói o dropdown de pai para este nó
    this._refreshParentDropdown(node);
  }

  /**
   * Lê os inputs TRS e aplica ao nó selecionado.
   * Chamado pelo evento 'input' em qualquer campo de transformação.
   *
   * Estratégia para campos em edição:
   *   parseFloat("") → NaN → usa o valor anterior como fallback.
   *   Isso evita que a matriz vire toda NaN enquanto o usuário digita "-".
   */
  _onTransformInput() {
    if (this._selectedId === null) return;
    const node = this.scene.getNode(this._selectedId);
    if (!node) return;

    const e = this._els;
    const t = node.transform;

    // Lê valor do input com fallback para o valor anterior se for NaN
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

    // Escala mínima 0.001 para evitar matriz singular (divisão por zero
    // na normal matrix e objetos invisíveis por escala zero)
    t.sx = Math.max(0.001, read(e.sx, t.sx));
    t.sy = Math.max(0.001, read(e.sy, t.sy));
    t.sz = Math.max(0.001, read(e.sz, t.sz));
  }

  // HIERARQUIA
  /**
   * Reconstrói o dropdown de seleção de pai para o nó selecionado.
   *
   * Exclui da lista:
   *  ─ O próprio nó (não pode ser pai de si mesmo)
   *  ─ Todos os descendentes do nó (causaria ciclo na hierarquia)
   *
   * Marca como selecionado o pai atual, se houver.
   *
   * @param {Node} selectedNode
   */
  _refreshParentDropdown(selectedNode) {
    const sel = this._els.parentSelect;

    // Limpa e adiciona opção "sem pai"
    sel.innerHTML = '<option value="">— Nenhum (Raiz) —</option>';

    for (const node of this.scene.getAllNodes()) {
      // Pula o próprio nó selecionado
      if (node.id === selectedNode.id) continue;

      // Pula os descendentes (seria hierarquia circular)
      if (isDescendantOf(node, selectedNode)) continue;

      const opt       = document.createElement('option');
      opt.value       = node.id;
      opt.textContent = node.name;

      // Marca o pai atual como selecionado
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
      // "— Nenhum (Raiz) —" selecionado → remove o pai
      node.setParent(null);
    } else {
      const parent = this.scene.getNode(parentId);
      if (parent) node.setParent(parent);
    }

    // Reconstrói a lista para mostrar a nova hierarquia
    this.refreshSceneList();
  }

  // ANIMAÇÃO
  /**
   * Lê os inputs de animação e aplica ao nó selecionado.
   *
   * Ao mudar o TIPO de animação, reseta os acumuladores de runtime
   * (_animAngle, _animTime) para que a nova animação comece do zero.
   * Isso evita saltos bruscos na posição/rotação do objeto.
   */
  _onAnimationInput() {
    if (this._selectedId === null) return;
    const node = this.scene.getNode(this._selectedId);
    if (!node) return;

    const e        = this._els;
    const prevType = node.animation.type;

    node.animation.type  = e.animType.value;
    node.animation.axis  = e.animAxis.value;
    node.animation.speed = Math.max(0, parseFloat(e.animSpeed.value) || 1.0);

    // Reseta acumuladores se o tipo de animação mudou
    if (node.animation.type !== prevType) {
      node._animAngle = 0;
      node._animTime  = 0;
    }

    // Atualiza o badge ⟳ na lista (aparece/some com a animação)
    this.refreshSceneList();
  }

  /**
   * Lê os inputs de textura e aplica ao nó selecionado.
   *
   * O color picker retorna uma string hex "#rrggbb".
   * Convertemos cada canal para o intervalo [0..1] dividindo por 255,
   * que é o que o shader espera no uniform u_tint.
   */
  _onTextureInput() {
    if (this._selectedId === null) return;
    const node = this.scene.getNode(this._selectedId);
    if (!node) return;

    const e   = this._els;
    const tex = node.texture;

    // Converte hex "#rrggbb" → RGB [0..1]
    const hex = e.texTint.value.replace('#', '');
    tex.tintR = parseInt(hex.slice(0, 2), 16) / 255;
    tex.tintG = parseInt(hex.slice(2, 4), 16) / 255;
    tex.tintB = parseInt(hex.slice(4, 6), 16) / 255;

    // Lê UV com fallback para o valor anterior se campo estiver vazio
    const read = (input, fallback) => {
      const v = parseFloat(input.value);
      return isNaN(v) ? fallback : v;
    };

    tex.offsetU = read(e.texOffsetU, tex.offsetU);
    tex.offsetV = read(e.texOffsetV, tex.offsetV);
    tex.scaleU  = Math.max(0.001, read(e.texScaleU, tex.scaleU));
    tex.scaleV  = Math.max(0.001, read(e.texScaleV, tex.scaleV));
  }

  // ESTADO DO PAINEL DE EDIÇÃO
  /**
   * Habilita ou desabilita o painel de edição de propriedades.
   *
   * Quando desabilitado:
   *  ─ Classe CSS 'disabled-section' escurece visualmente a seção
   *  ─ Todos os inputs e selects ficam com disabled=true
   *  ─ O botão deletar fica desabilitado
   *
   * @param {boolean} enabled
   */
  _setEditorEnabled(enabled) {
    const section = this._els.transformEditor;
    if (!section) return;

    if (enabled) {
      section.classList.remove('disabled-section');
    } else {
      section.classList.add('disabled-section');
    }

    // Habilita/desabilita todos os controles dentro da seção
    section.querySelectorAll('input, select').forEach(el => {
      el.disabled = !enabled;
    });
  }
  // LOADING OVERLAY
  /**
   * Atualiza o overlay de progresso durante o carregamento dos modelos.
   * Chamado por main.js via callback no ModelLoader.loadAll().
   *
   * Quando loaded >= total, faz fade out e esconde o overlay.
   *
   * @param {number} loaded — quantidade de modelos carregados até agora
   * @param {number} total  — total de modelos na lista
   */
  setLoadingProgress(loaded, total) {
    const overlay = this._els.loadingOverlay;
    const text    = this._els.loadingText;
    if (!overlay || !text) return;

    if (loaded >= total) {
      // Fade out suave ao terminar
      overlay.style.transition    = 'opacity 0.4s ease';
      overlay.style.opacity       = '0';
      overlay.style.pointerEvents = 'none';
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 450);
    } else {
      const pct = Math.round((loaded / total) * 100);
      text.textContent = `Carregando modelos… ${loaded} / ${total}  (${pct}%)`;

      // Barra de progresso visual (atualiza a largura via CSS)
      const bar = document.getElementById('loading-bar');
      if (bar) bar.style.width = `${pct}%`;
    }
  }
}
// Iago Kainan Bubolz Braatz


// UTILITÁRIO DE SEGURANÇA HTML

/**
 * Escapa caracteres HTML especiais para evitar XSS ao inserir
 * nomes de objetos diretamente como innerHTML.
 * @param {string} str
 * @returns {string}
 */
function _escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}