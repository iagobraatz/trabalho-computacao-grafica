export function saveSceneToFile(scene) {
  const data = scene.toJSON();

  data._meta = {
    version:   '1.0',
    savedAt:   new Date().toISOString(),
    nodeCount: data.nodes.length
  };

  const jsonString = JSON.stringify(data, null, 2);

  const blob = new Blob([jsonString], { type: 'application/json' });

  const url = URL.createObjectURL(blob);

  const filename = _buildFilename();
  const anchor   = document.createElement('a');
  anchor.href     = url;
  anchor.download = filename;

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  console.log(`[saveLoad] Cena salva: ${filename}  (${data.nodes.length} objetos)`);
}

function _buildFilename() {
  const now = new Date();

  const pad  = n => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  return `cena_${date}_${time}.json`;
}

export function loadSceneFromFile(file, scene, onComplete) {
  if (!file.name.endsWith('.json')) {
    alert(`Erro: o arquivo "${file.name}" não é um JSON.\nSelecione um arquivo .json salvo pelo editor.`);
    return;
  }

  const reader = new FileReader();

  reader.onload = (evt) => {
    const text = evt.target.result;

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

    const validationError = _validateSceneData(data);
    if (validationError) {
      alert(
        `Erro: o arquivo "${file.name}" não é uma cena válida.\n\n` +
        `Problema encontrado: ${validationError}`
      );
      return;
    }

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

    if (typeof onComplete === 'function') {
      onComplete();
    }
  };

  reader.onerror = () => {
    alert(
      `Erro: não foi possível ler o arquivo "${file.name}".\n` +
      `Verifique se o arquivo não está sendo usado por outro programa.`
    );
  };

  reader.readAsText(file, 'UTF-8');
}

function _validateSceneData(data) {
  if (!data || typeof data !== 'object') {
    return 'O arquivo não contém um objeto JSON válido.';
  }

  if (!Array.isArray(data.nodes)) {
    return 'Campo "nodes" ausente ou não é um array.';
  }

  for (let i = 0; i < data.nodes.length; i++) {
    const node = data.nodes[i];

    if (typeof node.id !== 'number') {
      return `Nó [${i}]: campo "id" ausente ou inválido.`;
    }

    if (typeof node.modelName !== 'string' || !node.modelName) {
      return `Nó [${i}] (id=${node.id}): campo "modelName" ausente ou vazio.`;
    }

    if (!node.transform || typeof node.transform !== 'object') {
      return `Nó [${i}] (id=${node.id}): campo "transform" ausente.`;
    }

    const requiredTRS = ['tx','ty','tz','rx','ry','rz','sx','sy','sz'];
    for (const key of requiredTRS) {
      if (typeof node.transform[key] !== 'number') {
        return `Nó [${i}] (id=${node.id}): transform.${key} ausente ou não numérico.`;
      }
    }
  }

  return null;
}