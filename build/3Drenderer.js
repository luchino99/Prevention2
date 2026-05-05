import * as THREE from "three";

//Import GLTFLoader
import { GLTFLoader } from "GLTFLoader";

const container = document.getElementById('device-3d-viewer');
const containerWidth = container.clientWidth;
const containerHeight = container.clientHeight;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, containerWidth / containerHeight, 0.1, 1000);//window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 1;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });


renderer.setSize(containerWidth, containerHeight);
renderer.setClearColor(0x000000, 0); // Nero con alpha 0

container.appendChild(renderer.domElement);

const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(light);

const loader = new GLTFLoader();
const modelPaths = [
  './assets/models/tablet.glb',
  './assets/models/tablet.glb',
  './assets/models/tablet.glb'
];

// ✅ Nuova disposizione orizzontale
const carouselPositions = [
  new THREE.Vector3(0, 0, 0),         // front center
  new THREE.Vector3(-1.2, 0, -1.5),   // back left
  new THREE.Vector3(1.2, 0, -1.5)     // back right
];

const carouselScales = [
  new THREE.Vector3(1, 1, 1),   // front
  new THREE.Vector3(0.6, 0.6, 0.6),   // back
  new THREE.Vector3(0.6, 0.6, 0.6)
];

let models = [];
let loadedCount = 0;
let frontIndex = 0;

modelPaths.forEach((path, i) => {
  loader.load(path, gltf => {
    const model = gltf.scene;
    model.rotation.y = 0;
    scene.add(model);
    models[i] = {
      mesh: model,
      targetPosition: carouselPositions[i].clone(),
      targetScale: carouselScales[i].clone()
    };

    if (++loadedCount === modelPaths.length) {
      updateTargets();
      animate();
      setInterval(rotateCarousel, 4000);
    }
  });
});

function updateTargets() {
  for (let i = 0; i < models.length; i++) {
    const posIndex = (i - frontIndex + 3) % 3;
    models[i].targetPosition = carouselPositions[posIndex].clone();
    models[i].targetScale = carouselScales[posIndex].clone();
  }
}

function rotateCarousel() {
  frontIndex = (frontIndex + 1) % 3;
  updateTargets();
}

function animate() {
  requestAnimationFrame(animate);

  models.forEach(obj => {
    obj.mesh.rotation.y += 0.01;
    obj.mesh.position.lerp(obj.targetPosition, 0.05);
    obj.mesh.scale.lerp(obj.targetScale, 0.05);
  });

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  const width = container.clientWidth;
  const height = container.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});
