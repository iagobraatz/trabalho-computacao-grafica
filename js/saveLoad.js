/**
 * saveLoad.js — Salvar e carregar a cena em arquivo JSON
 *
 * Este módulo cuida exclusivamente do I/O de arquivo no browser.
 * A serialização/deserialização dos dados da cena é delegada
 * para scene.toJSON() e scene.fromJSON() (veja scene.js).
 *
 * Fluxo de salvar:
 *   scene.toJSON()  →  JSON.stringify  →  Blob  →  <a download>  →  clique
 *
 * Fluxo de carregar:
 *   <input type="file">  →  FileReader  →  JSON.parse  →  scene.fromJSON()
 *
 * Ambos os fluxos são acionados por editor.js.
 * Este arquivo não conhece WebGL nem DOM além do necessário para I/O.
 */


// SALVAR
/**
 * Serializa a cena atual para JSON e dispara o download no browser.
 *
 * Passo a passo:
 *  1. Chama scene.toJSON() → objeto JavaScript com todos os nós e transforms
 *  2. JSON.stringify com indent=2 → string formatada e legível
 *  3. Empacota num Blob com MIME type application/json
 *  4. Cria URL temporária com URL.createObjectURL
 *  5. Cria um <a> invisível com atributo download e simula um clique
 *  6. Libera a URL com revokeObjectURL (evita leak de memória)
 *
 *
 * @param {Scene} scene — instância do grafo de cena
 */
export function saveSceneToFile(scene) {
  // 1. Serializa a cena para um objeto JavaScript simples
  const data = scene.toJSON();

  // Adiciona metadados úteis para referência futura
  data._meta = {
    version:   '1.0',
    savedAt:   new Date().toISOString(),
    nodeCount: data.nodes.length
  };

  // 2. Converte para string JSON formatada (indent 2 espaços)
  const jsonString = JSON.stringify(data, null, 2);

  // 3. Empacota num Blob binário com MIME type correto
  const blob = new Blob([jsonString], { type: 'application/json' });

  // 4. Gera uma URL temporária que aponta para o Blob na memória
  const url = URL.createObjectURL(blob);

  // 5. Cria um link invisível com atributo download e simula o clique
  const filename = _buildFilename();
  const anchor   = document.createElement('a');
  anchor.href     = url;
  anchor.download = filename;

  // O elemento não precisa estar no DOM para ser clicado,
  // mas alguns browsers mais antigos exigem que esteja.
  // Adicionamos e removemos imediatamente para compatibilidade.
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // 6. Libera a URL após um curto delay
  // (o delay garante que o browser iniciou o download antes de revogar)
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  console.log(`[saveLoad] Cena salva: ${filename}  (${data.nodes.length} objetos)`);
}

/**
 * Gera o nome do arquivo de save com timestamp.
 * Formato: cena_YYYY-MM-DD_HH-MM-SS.json
 * @returns {string}
 */
function _buildFilename() {
  const now = new Date();

  // Formata cada componente com padding de zero à esquerda
  const pad  = n => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  return `cena_${date}_${time}.json`;
}


// CARREGAR

/**
 * Lê um arquivo JSON do disco e reconstrói a cena a partir dele.
 *
 * Usa FileReader para leitura assíncrona (a leitura de arquivo no browser
 * é sempre assíncrona — nunca bloqueia a thread principal).
 *
 * Passo a passo:
 *  1. FileReader.readAsText(file) → dispara leitura assíncrona
 *  2. onload: recebe o texto quando a leitura termina
 *  3. JSON.parse(text) → valida o formato
 *  4. _validateSceneData(data) → checa campos obrigatórios
 *  5. scene.fromJSON(data) → reconstrói nós, transforms e hierarquia
 *  6. onComplete() → callback para editor.js atualizar a UI
 *
 * Qualquer erro (arquivo corrompido, formato inválido, campos faltando)
 * é capturado e exibido como alert. A cena atual NÃO é modificada
 * se a leitura ou parsing falharem.
 *
 * @param {File}     file       — arquivo selecionado pelo <input type="file">
 * @param {Scene}    scene      — instância do grafo de cena
 * @param {Function} onComplete — callback chamado após sucesso: () => void
 */
export function loadSceneFromFile(file, scene, onComplete) {
  // Verifica extensão antes de ler (feedback rápido para o usuário)
  if (!file.name.endsWith('.json')) {
    alert(`Erro: o arquivo "${file.name}" não é um JSON.\nSelecione um arquivo .json salvo pelo editor.`);
    return;
  }

  const reader = new FileReader();

  // ── Sucesso na leitura ──────────────────────────────────────────
  reader.onload = (evt) => {
    const text = evt.target.result;

    // Tenta parsear o JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      alert(
        `Erro ao ler o arquivo "${file.name}".\n` +
        `O arquivo pode estar corrompido ou não ser um JSON válido.\n\n` +
        `Detalhe: ${parseError.message}`
      );
      return;
    }

    // Valida a estrutura básica do JSON antes de aplicar à cena
    const validationError = _validateSceneData(data);
    if (validationError) {
      alert(
        `Erro: o arquivo "${file.name}" não é uma cena válida.\n\n` +
        `Problema encontrado: ${validationError}`
      );
      return;
    }

    // Aplica os dados à cena — scene.fromJSON() limpa a cena atual
    // e reconstrói tudo: nós, transforms, hierarquia e matrizes
    try {
      scene.fromJSON(data);
    } catch (sceneError) {
      alert(
        `Erro ao reconstruir a cena.\n\n` +
        `Detalhe: ${sceneError.message}`
      );
      return;
    }

    const count = data.nodes.length;
    console.log(
      `[saveLoad] Cena carregada: "${file.name}"  ` +
      `(${count} objeto${count !== 1 ? 's' : ''})`
    );

    // Notifica editor.js para atualizar a lista e limpar a seleção
    if (typeof onComplete === 'function') {
      onComplete();
    }
  };

  // ── Erro na leitura (arquivo bloqueado, disco, etc.) ────────────
  reader.onerror = () => {
    alert(
      `Erro: não foi possível ler o arquivo "${file.name}".\n` +
      `Verifique se o arquivo não está sendo usado por outro programa.`
    );
  };

  // Inicia a leitura assíncrona como texto (UTF-8 por padrão)
  reader.readAsText(file, 'UTF-8');
}


// VALIDAÇÃO DO JSON

/**
 * Valida a estrutura básica de um objeto JSON de cena.
 *
 * Não valida cada campo individualmente (seria muito rígido),
 * mas garante que os campos obrigatórios para a reconstrução
 * existem e têm o tipo correto.
 *
 * Campos verificados:
 *  ─ nodes        : Array   (lista de nós da cena)
 *  ─ nodes[i].id  : number  (identificador único)
 *  ─ nodes[i].modelName : string  (nome do modelo OBJ)
 *  ─ nodes[i].transform : object  (dados TRS)
 *
 * @param {object} data — objeto parseado do JSON
 * @returns {string|null} — mensagem de erro ou null se válido
 */
function _validateSceneData(data) {
  // Campo raiz obrigatório
  if (!data || typeof data !== 'object') {
    return 'O arquivo não contém um objeto JSON válido.';
  }

  if (!Array.isArray(data.nodes)) {
    return 'Campo "nodes" ausente ou não é um array.';
  }

  // Valida cada nó individualmente
  for (let i = 0; i < data.nodes.length; i++) {
    const node = data.nodes[i];

    if (typeof node.id !== 'number') {
      return `Nó [${i}]: campo "id" ausente ou inválido.`;
    }

    if (typeof node.modelName !== 'string' || !node.modelName) {
      return `Nó [${i}] (id=${node.id}): campo "modelName" ausente ou vazio.`;
    }
    // Iago Kainan Bubolz Braatz


    if (!node.transform || typeof node.transform !== 'object') {
      return `Nó [${i}] (id=${node.id}): campo "transform" ausente.`;
    }

    // Verifica campos TRS mínimos dentro do transform
    const requiredTRS = ['tx','ty','tz','rx','ry','rz','sx','sy','sz'];
    for (const key of requiredTRS) {
      if (typeof node.transform[key] !== 'number') {
        return `Nó [${i}] (id=${node.id}): transform.${key} ausente ou não numérico.`;
      }
    }
  }

  return null; // null = válido
}