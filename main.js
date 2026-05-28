import * as THREE from "three";

const cena = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);

const renderizador = new THREE.WebGLRenderer();

renderizador.setSize(window.innerWidth, window.innerHeight);

document.body.appendChild(renderizador.domElement);

const geometria = new THREE.BoxGeometry();
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });

const cubo = new THREE.Mesh(geometria, material);

cena.add(cubo);

camera.position.z = 5;

function animar() {
    requestAnimationFrame(animar);

    cubo.rotation.x += 0.01;
    cubo.rotation.y += 0.01;

    renderizador.render(cena, camera);
}

animar();