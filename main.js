import * as THREE from "three";
const objetosCena = [];
let contadorCubos = 0;
const cena = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);

const renderizador = new THREE.WebGLRenderer();

const viewport = document.getElementById("viewport");

renderizador.setSize(
    viewport.clientWidth,
    viewport.clientHeight
);
document.getElementById("viewport")
    .appendChild(renderizador.domElement);

renderizador.domElement.style.width = "100%";
renderizador.domElement.style.height = "100%";

const geometria = new THREE.BoxGeometry();
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });

const cubo = new THREE.Mesh(geometria, material);

cena.add(cubo);

function adicionarCubo() {

    contadorCubos++;

    const geometria = new THREE.BoxGeometry();

    const material = new THREE.MeshBasicMaterial({
        color: 0x00ff00
    });

    const cubo = new THREE.Mesh(
        geometria,
        material
    );

    cubo.position.x = contadorCubos * 2;

    cubo.name = `Cubo_${contadorCubos}`;

    cena.add(cubo);

    objetosCena.push(cubo);

    atualizarLista();
}

function atualizarLista() {

    const lista =
        document.getElementById("listaObjetos");

    lista.innerHTML = "";

    objetosCena.forEach(objeto => {

        const option =
            document.createElement("option");

        option.text = objeto.name;

        lista.appendChild(option);

    });
}

document
.getElementById("btnCubo")
.addEventListener(
    "click",
    adicionarCubo
);


camera.position.z = 5;

function animar() {
    requestAnimationFrame(animar);

    cubo.rotation.x += 0.01;
    cubo.rotation.y += 0.01;

    renderizador.render(cena, camera);
}

animar();