/**
 * camera.js — Câmera orbital para o editor de cena 3D
 * Controles:
 *   Botão esquerdo + arrastar     → orbitar
 *   Shift + arrastar              → pan
 *   Botão direito + arrastar      → pan
 *   Scroll do mouse               → zoom
 *
 * Separação com o sistema de picking:
 *   O picking (main.js) usa o evento 'click', que o browser só dispara
 *   quando o mouse NÃO se moveu entre mousedown e mouseup.
 *   A câmera usa 'mousedown' + 'mousemove', que é silencioso para cliques.
 *   → Não há conflito: arrastar = câmera, clicar = picking.
 */

import { mat4LookAt, mat4Perspective } from './math.js';

const DEG2RAD = Math.PI / 180;

export class Camera {

  /**
   * @param {HTMLCanvasElement} canvas — canvas WebGL (para eventos de mouse)
   */
  constructor(canvas) {
    this.canvas = canvas;
    // A posição cartesiana do olho é calculada em getEye().
    this.azimuth   = 45;    // começa a 45° para visão isométrica
    this.elevation = 30;    // 30° acima do chão
    this.distance  = 15;    // 15 unidades do alvo

    // ── Ponto alvo (o que a câmera olha) ─────────────────────────
    this.target = [0, 0, 0];

    // ── Parâmetros de projeção perspectiva ────────────────────────
    this.fovY = 45 * DEG2RAD;   // campo de visão vertical em radianos
    this.near = 0.1;             // plano de corte próximo
    this.far  = 1000;            // plano de corte distante

    // ── Estado interno do mouse ───────────────────────────────────
    this._isDragging  = false;
    this._lastMouseX  = 0;
    this._lastMouseY  = 0;
    this._mouseButton = -1;   // 0=esquerdo, 2=direito

    // ── Sensibilidades ────────────────────────────────────────────
    this.orbitSensitivity = 0.4;  // graus por pixel arrastado

    // Registra todos os eventos de mouse
    this._setupEvents();
  }

  // MATRIZES — chamadas a cada frame pelo renderer em main.js

  /**
   * Converte coordenadas esféricas (azimute, elevação, distância)
   * para a posição cartesiana do olho da câmera.
   *
   * Fórmula de conversão esférica → cartesiana (Y-up):
   *   x = distance * cos(el) * sin(az)
   *   y = distance * sin(el)
   *   z = distance * cos(el) * cos(az)
   *
   * @returns {number[3]} posição do olho no espaço do mundo
   */
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
  // Iago Kainan Bubolz Braatz
  /**
   * Retorna a view matrix: transforma do espaço do mundo para o
   * espaço da câmera.
   *
   * Usa mat4LookAt de math.js com eye calculado via getEye().
   * O vetor "up" do mundo é sempre [0, 1, 0] (eixo Y).
   *
   * @returns {Float32Array} view matrix 4×4 column-major
   */
  getViewMatrix() {
    return mat4LookAt(
      this.getEye(),
      this.target,
      [0, 1, 0]
    );
  }

  /**
   * Retorna a projection matrix: transforma do espaço da câmera
   * para clip space (projeção perspectiva).
   *
   * @param {number} aspect — largura / altura do canvas
   * @returns {Float32Array} projection matrix 4×4 column-major
   */
  getProjectionMatrix(aspect) {
    return mat4Perspective(this.fovY, aspect, this.near, this.far);
  }

  // OPERAÇÕES — chamadas pelos event listeners
  /**
   * Orbita a câmera ao redor do target.
   *
   * Azimute: rotação horizontal ao redor de Y.
   *   Subtrair dAz faz o arrastar para direita girar no sentido correto.
   *
   * Elevação: clampada entre -85° e +85° para evitar a câmera
   *   "virar de cabeça para baixo" (gimbal lock no polo).
   *
   * @param {number} dAz — variação de azimute em graus (pixels × sensibilidade)
   * @param {number} dEl — variação de elevação em graus
   */
  orbit(dAz, dEl) {
    this.azimuth   -= dAz;
    this.elevation  = Math.max(-85, Math.min(85, this.elevation + dEl));
  }

  /**
   * Pan: move o ponto alvo lateralmente sem alterar a orientação.
   *
   * Para mover no plano da câmera, precisamos dos vetores right e up
   * da câmera no espaço do mundo. Eles estão nas LINHAS da view matrix:
   *
   *   view matrix em column-major: m[col*4 + row]
   *   linha 0 (right): [m[0], m[4], m[8]]
   *   linha 1 (up):    [m[1], m[5], m[9]]
   *
   * A velocidade do pan é proporcional à distância e ao FOV:
   *   worldHeight = 2 * distance * tan(fovY/2)
   *   pixelSize   = worldHeight / canvas.height
   *
   * Isso faz o objeto debaixo do cursor acompanhar exatamente o mouse.
   *
   * @param {number} dx — movimento horizontal em pixels
   * @param {number} dy — movimento vertical em pixels
   */
  pan(dx, dy) {
    const view = this.getViewMatrix();

    // Vetores right e up da câmera extraídos da view matrix
    const right = [view[0], view[4], view[8]];
    const up    = [view[1], view[5], view[9]];

    // Tamanho de 1 pixel em unidades de mundo à distância atual
    const worldHeight = 2 * this.distance * Math.tan(this.fovY * 0.5);
    const pixelSize   = worldHeight / this.canvas.clientHeight;

    // Move o target: arrastar para direita → target vai para direita (-right)
    // arrastar para cima → target vai para cima (+up)
    this.target[0] += (-dx * right[0] + dy * up[0]) * pixelSize;
    this.target[1] += (-dx * right[1] + dy * up[1]) * pixelSize;
    this.target[2] += (-dx * right[2] + dy * up[2]) * pixelSize;
  }

  /**
   * Zoom: aproxima ou afasta mudando a distância ao target.
   *
   * Usa zoom multiplicativo (não aditivo) para que a velocidade
   * de zoom seja proporcional à distância atual:
   *   - Perto do objeto: zoom lento (preciso)
   *   - Longe do objeto: zoom rápido (eficiente)
   *
   * O deltaY do wheel event pode variar muito entre browsers/dispositivos,
   * então normalizamos para no máximo 120 unidades por evento.
   *
   * @param {number} deltaY — valor do evento wheel (positivo = afastar)
   */
  zoom(deltaY) {
    // Normaliza o delta (trackpads geram valores muito menores que mice)
    const normalized = Math.sign(deltaY) * Math.min(Math.abs(deltaY), 120);

    // Factor multiplicativo: 1.001 por unidade de scroll
    const factor = 1 + normalized * 0.001;

    this.distance = Math.max(0.5, Math.min(500, this.distance * factor));
  }

  // EVENTOS DE MOUSE
  /**
   * Registra todos os event listeners necessários.
   *
   * Nota sobre separação com o picking (main.js):
   *   - Picking usa 'click' → só dispara se o mouse não se moveu
   *   - Câmera usa 'mousedown'+'mousemove' → não interfere com click
   *   → Arrastar = câmera. Clicar sem mover = picking. Zero conflito.
   *
   * mousemove e mouseup ficam no 'window' (não no canvas) para que
   * o drag continue funcionando mesmo se o mouse sair do canvas.
   */
  _setupEvents() {
    const canvas = this.canvas;

    // ── Início do drag ──────────────────────────────────────────
    canvas.addEventListener('mousedown', (e) => {
      // Ignora cliques nos painéis HTML (eles não chegam aqui,
      // mas por segurança verificamos se é o canvas mesmo)
      this._isDragging  = true;
      this._lastMouseX  = e.clientX;
      this._lastMouseY  = e.clientY;
      this._mouseButton = e.button;

      // Previne seleção de texto acidental durante o drag
      e.preventDefault();
    });

    // ── Movimento do mouse ──────────────────────────────────────
    window.addEventListener('mousemove', (e) => {
      if (!this._isDragging) return;

      const dx = e.clientX - this._lastMouseX;
      const dy = e.clientY - this._lastMouseY;

      // Atualiza posição anterior para o próximo evento
      this._lastMouseX = e.clientX;
      this._lastMouseY = e.clientY;

      // Se não houve movimento real, ignora
      if (dx === 0 && dy === 0) return;

      const isPan = e.shiftKey || this._mouseButton === 2;

      if (isPan) {
        // Shift + arrastar OU botão direito → pan
        this.pan(dx, dy);
      } else if (this._mouseButton === 0) {
        // Botão esquerdo → orbit
        this.orbit(
          dx * this.orbitSensitivity,
          dy * this.orbitSensitivity
        );
      }
    });

    // ── Fim do drag ─────────────────────────────────────────────
    window.addEventListener('mouseup', () => {
      this._isDragging  = false;
      this._mouseButton = -1;
    });

    // ── Zoom ────────────────────────────────────────────────────
    // passive: false permite chamar preventDefault()
    // (necessário para impedir o scroll da página)
    canvas.addEventListener('wheel', (e) => {
      this.zoom(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    // ── Bloqueia menu de contexto ────────────────────────────────
    // Impede o menu do browser ao clicar com botão direito no canvas,
    // pois usamos o botão direito para pan.
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }

  // ────────────────────────────────────────────────────────────────
  // ESTADO PÚBLICO
  // ────────────────────────────────────────────────────────────────

  /**
   * Retorna true se o usuário está arrastando o mouse.
   * Usado em main.js para saber se o drag ainda está ativo.
   */
  get isDragging() {
    return this._isDragging;
  }

  /**
   * Reseta a câmera para a posição inicial.
   * Útil para o botão "Reset Camera" no editor.
   */
  reset() {
    this.azimuth   = 45;
    this.elevation = 30;
    this.distance  = 15;
    this.target    = [0, 0, 0];
  }
}