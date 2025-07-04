// --- 3rd Person Stealth MVP: Rat Plague ---
// Uses Three.js, Cannon-es, and GLTFLoader as ES modules from esm.sh CDN

import * as THREE from "https://esm.sh/three@0.153.0";
import { GLTFLoader } from "https://esm.sh/three@0.153.0/examples/jsm/loaders/GLTFLoader.js";
import * as CANNON from "https://esm.sh/cannon-es@0.20.0";

// === GLOBALS ===
let scene, camera, renderer, world;
let rat, ratBody, ratMixer, ratActions = {}, controls, canDash = true, dashCooldown = 0, dashTimer = 0;
let traps = [], trapBodies = [];
let roomba, roombaBody, roombaMixer;
let human, humanBody, humanMixer;
let walls = [], wallBodies = [];
let floor, floorBody, ceiling, ceilingBody;
let gameState = 'loading'; // 'loading', 'playing', 'dead', 'win'
let startPos = { x: -3, y: 0.3, z: -3 };
let clock = new THREE.Clock();

// === UI ELEMENTS ===
const dashCooldownDiv = document.getElementById('dash-cooldown');
const messageOverlay = document.getElementById('message-overlay');
const restartBtn = document.getElementById('restart-btn');

// === INIT ===
init();

async function init() {
  // --- THREE ---
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);

  // Lighting
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(8, 12, 8);
  scene.add(dirLight);
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));

  // Camera (third-person chase)
  camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.1, 100);
  camera.position.set(0, 2, -5);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('game-container').appendChild(renderer.domElement);

  // --- CANNON ---
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 10;

  // --- ROOM (walls, floor, ceiling) ---
  createRoom();

  // --- MODELS ---
  await loadModels();

  // --- CONTROLS ---
  controls = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    dash: false,
    lastDir: new THREE.Vector3(0, 0, 1),
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  restartBtn.addEventListener('click', restartGame);
  window.addEventListener('resize', onWindowResize);

  gameState = 'playing';
  animate();
}

function createRoom() {
  // Floor
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x8d6748, roughness: 0.7 });
  floor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 8), floorMat);
  floor.position.set(0, 0, 0);
  scene.add(floor);
  floorBody = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(4, 0.1, 4)), position: new CANNON.Vec3(0, 0, 0) });
  world.addBody(floorBody);
  // Ceiling
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.9 });
  ceiling = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 8), ceilMat);
  ceiling.position.set(0, 3.5, 0);
  scene.add(ceiling);
  ceilingBody = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(4, 0.1, 4)), position: new CANNON.Vec3(0, 3.5, 0) });
  world.addBody(ceilingBody);
  // Walls
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const wallGeo = new THREE.BoxGeometry(8, 3.5, 0.2);
  const wallPos = [
    [0, 1.75, -4], // back
    [0, 1.75, 4],  // front
  ];
  wallPos.forEach(([x, y, z]) => {
    const mesh = new THREE.Mesh(wallGeo, wallMat);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    walls.push(mesh);
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(4, 1.75, 0.1)), position: new CANNON.Vec3(x, y, z) });
    world.addBody(body);
    wallBodies.push(body);
  });
  // Side walls
  const sideGeo = new THREE.BoxGeometry(0.2, 3.5, 8);
  const sidePos = [
    [-4, 1.75, 0],
    [4, 1.75, 0],
  ];
  sidePos.forEach(([x, y, z]) => {
    const mesh = new THREE.Mesh(sideGeo, wallMat);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    walls.push(mesh);
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.1, 1.75, 4)), position: new CANNON.Vec3(x, y, z) });
    world.addBody(body);
    wallBodies.push(body);
  });
}

async function loadModels() {
  const loader = new GLTFLoader();
  // --- RAT ---
  await loader.loadAsync('assets/rat.glb').then(gltf => {
    rat = gltf.scene;
    rat.traverse(obj => { if (obj.isMesh) obj.castShadow = true; });
    rat.scale.set(0.25, 0.25, 0.25);
    scene.add(rat);
    // Animation
    if (gltf.animations && gltf.animations.length) {
      ratMixer = new THREE.AnimationMixer(rat);
      gltf.animations.forEach(clip => {
        ratActions[clip.name] = ratMixer.clipAction(clip);
      });
      if (ratActions['Idle']) ratActions['Idle'].play();
    }
    // Physics
    ratBody = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Sphere(0.18),
      position: new CANNON.Vec3(startPos.x, startPos.y, startPos.z),
      material: new CANNON.Material({ friction: 0.3, restitution: 0.1 })
    });
    ratBody.linearDamping = 0.7;
    world.addBody(ratBody);
  });
  // --- HUMAN ---
  await loader.loadAsync('assets/human.glb').then(gltf => {
    human = gltf.scene;
    human.scale.set(0.5, 0.5, 0.5);
    human.position.set(3, 0, 3);
    scene.add(human);
    if (gltf.animations && gltf.animations.length) {
      humanMixer = new THREE.AnimationMixer(human);
      humanMixer.clipAction(gltf.animations[0]).play();
    }
    humanBody = new CANNON.Body({ mass: 0, shape: new CANNON.Sphere(0.3), position: new CANNON.Vec3(3, 0.3, 3) });
    world.addBody(humanBody);
  });
  // --- ROOMBA ---
  await loader.loadAsync('assets/roomba.glb').then(gltf => {
    roomba = gltf.scene;
    roomba.scale.set(0.3, 0.3, 0.3);
    scene.add(roomba);
    roombaBody = new CANNON.Body({ mass: 1, shape: new CANNON.Cylinder(0.18, 0.18, 0.07, 16), position: new CANNON.Vec3(0, 0.07, 0) });
    roombaBody.type = CANNON.Body.KINEMATIC;
    world.addBody(roombaBody);
  });
  // --- TRAPS ---
  const trapPositions = [
    { x: 0, y: 0.05, z: 2 },
    { x: -2, y: 0.05, z: -1 },
    { x: 2, y: 0.05, z: -2 },
  ];
  for (let pos of trapPositions) {
    await loader.loadAsync('assets/mousetrap.glb').then(gltf => {
      const trap = gltf.scene;
      trap.scale.set(0.18, 0.18, 0.18);
      trap.position.set(pos.x, pos.y, pos.z);
      scene.add(trap);
      traps.push(trap);
      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.18, 0.03, 0.18)), position: new CANNON.Vec3(pos.x, pos.y, pos.z) });
      world.addBody(body);
      trapBodies.push(body);
    });
  }
}

function onKeyDown(e) {
  if (gameState !== 'playing') return;
  switch (e.code) {
    case 'KeyW': controls.forward = true; break;
    case 'KeyS': controls.backward = true; break;
    case 'KeyA': controls.left = true; break;
    case 'KeyD': controls.right = true; break;
    case 'ShiftLeft':
    case 'ShiftRight':
      if (canDash) controls.dash = true;
      break;
  }
}
function onKeyUp(e) {
  switch (e.code) {
    case 'KeyW': controls.forward = false; break;
    case 'KeyS': controls.backward = false; break;
    case 'KeyA': controls.left = false; break;
    case 'KeyD': controls.right = false; break;
    case 'ShiftLeft':
    case 'ShiftRight':
      controls.dash = false;
      break;
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (ratMixer) ratMixer.update(dt);
  if (humanMixer) humanMixer.update(dt);
  // Roomba movement
  moveRoomba();
  // Physics
  if (gameState === 'playing') {
    handleRatMovement();
    world.step(1/60);
    updateObjects();
    checkCollisions();
    updateDashUI();
  }
  updateCamera();
  renderer.render(scene, camera);
}

function handleRatMovement() {
  // WASD movement (XZ plane)
  let move = new THREE.Vector3();
  if (controls.forward) move.z -= 1;
  if (controls.backward) move.z += 1;
  if (controls.left) move.x -= 1;
  if (controls.right) move.x += 1;
  if (move.lengthSq() > 0) {
    move.normalize();
    controls.lastDir.copy(move);
    // Apply force for movement
    const speed = 4.5;
    const vel = ratBody.velocity;
    let desired = move.clone().multiplyScalar(speed);
    let diff = new THREE.Vector3(desired.x - vel.x, 0, desired.z - vel.z);
    ratBody.applyForce(new CANNON.Vec3(diff.x * 8, 0, diff.z * 8));
    // Tilt rat body for realism
    if (rat) rat.rotation.z = -move.x * 0.25;
  } else {
    if (rat) rat.rotation.z = 0;
  }
  // Dash
  if (controls.dash && canDash) {
    canDash = false;
    dashCooldown = 3.0;
    dashTimer = 0;
    let dashVec = controls.lastDir.clone().normalize().multiplyScalar(10);
    ratBody.applyImpulse(new CANNON.Vec3(dashVec.x, 0, dashVec.z));
    controls.dash = false;
  }
  // Dash cooldown
  if (!canDash) {
    dashTimer += 1/60;
    dashCooldown = Math.max(0, 3.0 - dashTimer);
    if (dashCooldown <= 0) {
      canDash = true;
      dashCooldown = 0;
    }
  }
}

function updateDashUI() {
  if (canDash) {
    dashCooldownDiv.textContent = 'Dash Ready';
    dashCooldownDiv.style.color = '#2ecc40';
  } else {
    dashCooldownDiv.textContent = `Dash: ${dashCooldown.toFixed(1)}s`;
    dashCooldownDiv.style.color = '#ff3333';
  }
}

function moveRoomba() {
  // Move Roomba in a square path
  if (!roombaBody) return;
  const path = [
    { x: 2, z: 2 },
    { x: -2, z: 2 },
    { x: -2, z: -2 },
    { x: 2, z: -2 },
  ];
  if (!moveRoomba.idx) moveRoomba.idx = 0;
  if (!moveRoomba.t) moveRoomba.t = 0;
  const curr = path[moveRoomba.idx];
  const next = path[(moveRoomba.idx + 1) % path.length];
  const pos = roombaBody.position;
  const dir = { x: next.x - curr.x, z: next.z - curr.z };
  const dist = Math.sqrt(dir.x*dir.x + dir.z*dir.z);
  if (dist > 0) {
    dir.x /= dist; dir.z /= dist;
    let moveStep = 1.2 * (1/60);
    pos.x += dir.x * moveStep;
    pos.z += dir.z * moveStep;
    if (Math.abs(pos.x - next.x) < 0.05 && Math.abs(pos.z - next.z) < 0.05) {
      moveRoomba.idx = (moveRoomba.idx + 1) % path.length;
      roombaBody.position.x = next.x;
      roombaBody.position.z = next.z;
    }
  }
}

function updateObjects() {
  // Sync Three.js meshes with Cannon bodies
  if (rat && ratBody) {
    rat.position.copy(ratBody.position);
    rat.position.y = ratBody.position.y;
    rat.rotation.y = Math.atan2(ratBody.velocity.x, ratBody.velocity.z);
  }
  if (roomba && roombaBody) {
    roomba.position.copy(roombaBody.position);
    roomba.position.y = 0.07;
  }
  if (human && humanBody) {
    human.position.copy(humanBody.position);
    human.position.y = 0.3;
  }
  for (let i = 0; i < traps.length; i++) {
    if (trapBodies[i]) traps[i].position.copy(trapBodies[i].position);
  }
}

function updateCamera() {
  // Third-person chase cam: behind and above rat, smooth follow
  if (!rat || !ratBody) return;
  const offset = new THREE.Vector3(0, 1.2, -2.8);
  const target = ratBody.position.clone().add(offset.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), rat.rotation.y)));
  camera.position.lerp(target, 0.12);
  camera.lookAt(ratBody.position.x, ratBody.position.y + 0.5, ratBody.position.z);
}

function checkCollisions() {
  // --- Traps ---
  for (let i = 0; i < trapBodies.length; i++) {
    if (checkAABB(ratBody, trapBodies[i], 0.18, [0.18,0.03,0.18])) {
      onDeath('You Died!');
      return;
    }
  }
  // --- Roomba ---
  if (roombaBody && checkAABB(ratBody, roombaBody, 0.18, [0.18,0.07,0.18])) {
    onDeath('You Died!');
    return;
  }
  // --- Human (goal) ---
  if (humanBody && checkAABB(ratBody, humanBody, 0.18, [0.3,0.3,0.3])) {
    onWin();
    return;
  }
}

function checkAABB(bodyA, bodyB, rA, sizeB) {
  // bodyA: sphere (radius rA), bodyB: box/cylinder (sizeB = [x,y,z])
  let a = bodyA.position, b = bodyB.position;
  let dx = Math.max(Math.abs(a.x - b.x) - sizeB[0], 0);
  let dy = Math.max(Math.abs(a.y - b.y) - sizeB[1], 0);
  let dz = Math.max(Math.abs(a.z - b.z) - sizeB[2], 0);
  return (dx*dx + dy*dy + dz*dz) < (rA*rA);
}

function onDeath(msg) {
  gameState = 'dead';
  showMessage(msg);
  restartBtn.classList.remove('hidden');
}
function onWin() {
  gameState = 'win';
  showMessage('You Infected the Human!');
  restartBtn.classList.remove('hidden');
}
function showMessage(msg) {
  messageOverlay.textContent = msg;
  messageOverlay.classList.remove('hidden');
}
function hideMessage() {
  messageOverlay.classList.add('hidden');
}
function restartGame() {
  // Reset rat position and velocity
  if (ratBody) {
    ratBody.position.set(startPos.x, startPos.y, startPos.z);
    ratBody.velocity.set(0,0,0);
    ratBody.angularVelocity.set(0,0,0);
  }
  canDash = true;
  dashCooldown = 0;
  dashTimer = 0;
  gameState = 'playing';
  hideMessage();
  restartBtn.classList.add('hidden');
} 