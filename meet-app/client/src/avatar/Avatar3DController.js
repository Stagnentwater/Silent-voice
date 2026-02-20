import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const JOINTS = {
  leftShoulder: 11,
  leftElbow: 13,
  leftWrist: 15,
  rightShoulder: 12,
  rightElbow: 14,
  rightWrist: 16,
  leftHip: 23,
  leftKnee: 25,
  leftAnkle: 27,
  rightHip: 24,
  rightKnee: 26,
  rightAnkle: 28
};

const BONES = [
  ['LeftUpperArm', 'leftShoulder', 'leftElbow'],
  ['LeftLowerArm', 'leftElbow', 'leftWrist'],
  ['RightUpperArm', 'rightShoulder', 'rightElbow'],
  ['RightLowerArm', 'rightElbow', 'rightWrist'],
  ['LeftUpperLeg', 'leftHip', 'leftKnee'],
  ['LeftLowerLeg', 'leftKnee', 'leftAnkle'],
  ['RightUpperLeg', 'rightHip', 'rightKnee'],
  ['RightLowerLeg', 'rightKnee', 'rightAnkle']
];

function lerpVec(prev, next, t) {
  return new THREE.Vector3(
    THREE.MathUtils.lerp(prev.x, next.x, t),
    THREE.MathUtils.lerp(prev.y, next.y, t),
    THREE.MathUtils.lerp(prev.z, next.z, t)
  );
}

function toScenePoint(lm) {
  if (!lm) return null;
  const x = (lm.x - 0.5) * 2;
  const y = (0.5 - lm.y) * 2;
  const z = -(lm.z || 0) * 2;
  return new THREE.Vector3(x, y, z);
}

export class Avatar3DController {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.model = null;
    this.bones = {};
    this.prevJoints = new Map();
    this.container = null;
    this.visible = false;
  }

  init(containerElement) {
    if (!containerElement || this.scene) {
      return;
    }

    this.container = containerElement;
    const width = containerElement.clientWidth || 640;
    const height = containerElement.clientHeight || 360;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 1.2, 3);

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    const directional = new THREE.DirectionalLight(0xffffff, 0.6);
    directional.position.set(1, 2, 2);
    this.scene.add(ambient, directional);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.shadowMap.enabled = false;
    this.renderer.domElement.style.display = 'none';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    containerElement.appendChild(this.renderer.domElement);

    const loader = new GLTFLoader();
    loader.load('/avatar.glb', (gltf) => {
      this.model = gltf.scene;
      this.model.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = false;
          obj.receiveShadow = false;
        }
        if (obj.isBone) {
          this.bones[obj.name] = obj;
        }
      });
      this.scene.add(this.model);
    });

    window.addEventListener('resize', this.handleResize);
  }

  handleResize = () => {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth || 640;
    const height = this.container.clientHeight || 360;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  setVisible(isVisible) {
    this.visible = isVisible;
    if (this.renderer && this.renderer.domElement) {
      this.renderer.domElement.style.display = isVisible ? 'block' : 'none';
    }
  }

  update(landmarks) {
    if (!this.visible || !landmarks || !this.model) {
      return;
    }

    const smoothed = {};
    Object.entries(JOINTS).forEach(([key, index]) => {
      const pt = toScenePoint(landmarks[index]);
      if (!pt) return;
      const prev = this.prevJoints.get(key) || pt;
      const next = lerpVec(prev, pt, 0.3);
      smoothed[key] = next;
      this.prevJoints.set(key, next);
    });

    BONES.forEach(([boneName, parentKey, childKey]) => {
      const bone = this.bones[boneName];
      const parent = smoothed[parentKey];
      const child = smoothed[childKey];
      if (!bone || !parent || !child) return;

      const targetDir = new THREE.Vector3().subVectors(child, parent).normalize();
      if (!Number.isFinite(targetDir.x + targetDir.y + targetDir.z)) return;

      const defaultDir = new THREE.Vector3(0, 1, 0);
      bone.quaternion.setFromUnitVectors(defaultDir, targetDir);
    });

    this.renderer.render(this.scene, this.camera);
  }
}
