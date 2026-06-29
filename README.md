# Editor de Cena 3D — CityBits

Trabalho da disciplina de **Computação Gráfica**
**Aluno:** Iago Kainan Bubolz Braatz
**Curso:** Ciência da Computação — UFPel

---

## Descrição

Este projeto é um editor de cena 3D que roda inteiramente no navegador, usando **WebGL2** puro (sem bibliotecas como Three.js). O site carrega um conjunto de modelos `.obj` do pacote *CityBits* (KayKit), permite montá-los em uma cena através de uma interface HTML, editar suas propriedades (transformação, textura, animação e hierarquia) e salvar/carregar a cena em um arquivo JSON.

---

## Funcionalidades implementadas

- **Carregamento de modelos `.obj`** via parser próprio (sem bibliotecas de terceiros)
- **Painel de modelos** com miniatura 3D real de cada modelo (renderizada off-screen)
- **Adicionar à cena**: clicar em um modelo no painel direito o insere no centro da cena
- **Seleção de objetos**:
  - Pela lista de nomes no painel esquerdo
  - **Picking por cor com o mouse**, clicando diretamente no objeto dentro da cena 3D
- **Edição de transformações**: translação, rotação e escala (X, Y, Z)
- **Edição de propriedades de textura**: tint de cor, offset UV e escala UV
- **Animação**: rotação contínua ou translação tipo pingpong, com eixo e velocidade configuráveis
- **Hierarquia de objetos**: qualquer objeto pode ser filho de outro; transformações são herdadas do pai
- **Compartilhamento de geometria**: cada modelo existe uma única vez na memória da GPU; múltiplas instâncias na cena reutilizam o mesmo VAO, alterando apenas suas transformações e propriedades
- **Salvar cena** em arquivo `.json`
- **Carregar cena** a partir de um `.json` salvo anteriormente
- **Câmera orbital** controlada com o mouse (orbitar, pan e zoom)

---

## Como executar

1. Abra a pasta do projeto no VS Code
2. Instale a extensão **Live Server** (se ainda não tiver)
3. Clique com o botão direito em `index.html` → **Open with Live Server**
4. O site abrirá.

---

## Controles da câmera

| Ação                          | Controle                          |
|-------------------------------|------------------------------------|
| Orbitar a câmera               | Botão esquerdo do mouse + arrastar |
| Mover o ponto de foco (pan)    | `Shift` + arrastar, ou botão direito + arrastar |
| Zoom                           | Scroll do mouse                    |
| Selecionar objeto na cena      | Clique simples sobre o objeto      |

---

## Estrutura do projeto

```
trabalho-computacao-grafica/
├── index.html          # Layout da página: painéis HTML + canvas WebGL
├── style.css            # Estilo visual de todos os painéis e controles
├── main.js              # Shaders, inicialização do WebGL, loop de
│                         # renderização, picking por cor, geração de
│                         # miniaturas dos modelos
│
├── js/
│   ├── math.js           # Operações matriciais (mat4, mat3) usadas em
│   │                     # toda a aplicação: projeção, view, TRS, normais
│   ├── loader.js         # Parser de arquivos .obj e cache de modelos
│   │                     # na GPU (cada modelo carregado uma única vez)
│   ├── scene.js          # Grafo de cena: nós, hierarquia, transformações,
│   │                     # animação e serialização para JSON
│   ├── camera.js         # Câmera orbital (orbit, pan, zoom) controlada
│   │                     # pelo mouse
│   ├── editor.js         # Toda a UI HTML: lista de objetos, painel de
│   │                     # propriedades, painel de modelos, hierarquia
│   └── saveLoad.js       # Exportação e importação da cena em JSON
│
├── models/               # Arquivos .obj/.mtl do pacote CityBits
└── textures/             # Textura atlas compartilhada (citybits_texture.png)
```

---

## Arquitetura técnica

### Carregamento de modelos

Os arquivos `.obj` são lidos via `fetch()` e parseados manualmente em `loader.js`. Como o formato OBJ referencia posição, coordenada de textura e normal por índices separados (`v/vt/vn`), cada combinação única dessas três referências é expandida em um vértice próprio antes de ser enviada para a GPU, processo necessário pois o WebGL exige um único índice por vértice.

Cada modelo é carregado para a GPU **uma única vez** e fica em cache (`ModelLoader`). Ao adicionar o mesmo modelo várias vezes na cena, todas as instâncias compartilham o mesmo VAO; apenas a matriz de transformação e as propriedades de textura mudam entre elas — atendendo ao requisito de não duplicar geometria na memória.

### Grafo de cena e hierarquia

A cena é representada por um grafo de nós (`scene.js`), no qual cada nó possui:

- uma matriz local (`localMatrix`), construída a partir de translação, rotação e escala
- uma matriz de mundo (`worldMatrix`), calculada recursivamente como `worldMatrix = parentWorldMatrix × localMatrix`

Esse padrão permite que um objeto filho herde toda a transformação acumulada de seus ancestrais, exatamente como em uma hierarquia de cena tradicional (ex.: rodas que seguem o corpo de um carro).

### Seleção por picking de cor

Ao clicar na cena, a aplicação renderiza a cena inteira para um framebuffer fora da tela, onde cada objeto recebe uma cor sólida correspondente ao seu identificador numérico (codificado nos 4 canais RGBA). Em seguida, o pixel sob o cursor é lido com `readPixels` e o identificador é decodificado de volta, revelando qual objeto foi clicado — sem a necessidade de testes geométricos de interseção raio-objeto.

A distinção entre clique e arraste de câmera é resolvida pelo próprio navegador: o evento `click` só é disparado quando o mouse não se move entre pressionar e soltar o botão, enquanto a câmera responde a `mousedown` + `mousemove`.

### Animação

O loop de renderização calcula o tempo decorrido entre quadros (`deltaTime`) a cada chamada de `requestAnimationFrame`, garantindo que a velocidade das animações seja independente da taxa de quadros do dispositivo do usuário.

### Salvar e carregar

A cena inteira (lista de objetos, suas transformações, propriedades de textura, animações e relações de hierarquia) é serializada para um objeto JSON e oferecida como download pelo navegador. O carregamento faz o processo inverso, validando a estrutura do arquivo antes de reconstruir a cena.

---

## Modelos utilizados

Os modelos são do pacote **CityBits** (KayKit), disponível gratuitamente em formato `.obj` com uma textura atlas compartilhada (`citybits_texture.png`). Nem todos os modelos do pacote original foram incluídos no painel — apenas um subconjunto representativo (edifícios, veículos, vias, semáforos, vegetação e mobiliário urbano), conforme permitido pelo enunciado do trabalho.

---

## Observações

- Todo o código WebGL foi escrito manualmente, sem bibliotecas de abstração (como Three.js ou TWGL), seguindo os tutoriais de referência indicados no enunciado do trabalho (WebGL2Fundamentals.org).
- A interface de edição (menus, botões, campos de texto) é construída inteiramente em HTML/CSS, fora do canvas WebGL, conforme solicitado.