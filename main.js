// --- 3D Stealth MVP: Rat Plague ---
// Uses Three.js and Cannon-es as ES modules via esm.sh CDN

import * as THREE from "https://esm.sh/three@0.153.0";
import { OrbitControls } from "https://esm.sh/three@0.153.0/examples/jsm/controls/OrbitControls.js";
import * as CANNON from "https://esm.sh/cannon-es@0.20.0";

// === GLOBALS ===
let scene, camera, renderer, world;
let rat, ratBody, controls, canDash = true, dashCooldown = 0, dashTimer = 0;
let traps = [], trapBodies = [];
let roomba, roombaBody, roombaPath, roombaPathIndex = 0, roombaSpeed = 2;
let human, humanBody;
let walls = [], wallBodies = [];
let floor, floorBody;
let gameState = 'playing'; // 'playing', 'dead', 'win'
let startPos = { x: -6, y: 0.5, z: -6 };

// === UI ELEMENTS ===
const dashCooldownDiv = document.getElementById('dash-cooldown');
const messageOverlay = document.getElementById('message-overlay');
const restartBtn = document.getElementById('restart-btn');

// === INIT ===
init();
animate();

function init() {
  // --- THREE ---
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);

  // Add grid helper for debugging
  scene.add(new THREE.GridHelper(16, 16, 0x888888, 0x444444));

  camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.1, 100);
  camera.position.set(0, 14, 14);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('game-container').appendChild(renderer.domElement);

  // Add OrbitControls for debugging (remove for production)
  window.controls3d = new OrbitControls(camera, renderer.domElement);
  window.controls3d.target.set(0, 0, 0);
  window.controls3d.update();

  // --- CANNON ---
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 10;

  // --- FLOOR ---
  const floorGeo = new THREE.PlaneGeometry(16, 16, 16, 16);
  const floorMat = new THREE.MeshBasicMaterial({ color: 0x444444, wireframe: true });
  floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI/2;
  scene.add(floor);
  floorBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  floorBody.quaternion.setFromEuler(-Math.PI/2, 0, 0);
  world.addBody(floorBody);

  // --- WALLS (simple box room) ---
  const wallData = [
    // x, y, z, sx, sy, sz
    [0, 1, -8, 16, 2, 0.5], // back
    [0, 1, 8, 16, 2, 0.5],  // front
    [-8, 1, 0, 0.5, 2, 16], // left
    [8, 1, 0, 0.5, 2, 16],  // right
  ];
  wallData.forEach(([x, y, z, sx, sy, sz]) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(sx, sy, sz),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    mesh.position.set(x, y, z);
    scene.add(mesh);
    walls.push(mesh);
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(sx/2, sy/2, sz/2)), position: new CANNON.Vec3(x, y, z) });
    world.addBody(body);
    wallBodies.push(body);
  });

  // --- LIGHT ---
  const light = new THREE.DirectionalLight(0xffffff, 0.8);
  light.position.set(10, 20, 10);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));

  // --- RAT (player) ---
  const ratGeo = new THREE.SphereGeometry(0.5, 16, 16);
  const ratMat = new THREE.MeshStandardMaterial({ color: 0x8888ff });
  rat = new THREE.Mesh(ratGeo, ratMat);
  scene.add(rat);
  ratBody = new CANNON.Body({
    mass: 1,
    shape: new CANNON.Sphere(0.5),
    position: new CANNON.Vec3(startPos.x, startPos.y, startPos.z),
    material: new CANNON.Material({ friction: 0.2, restitution: 0.1 })
  });
  ratBody.linearDamping = 0.6;
  world.addBody(ratBody);

  // --- HUMAN (goal) ---
  const humanGeo = new THREE.CylinderGeometry(0.6, 0.6, 1.4, 20);
  const humanMat = new THREE.MeshStandardMaterial({ color: 0x2ecc40 });
  human = new THREE.Mesh(humanGeo, humanMat);
  human.position.set(6, 0.7, 6);
  scene.add(human);
  humanBody = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(0.6, 0.6, 1.4, 20), position: new CANNON.Vec3(6, 0.7, 6) });
  world.addBody(humanBody);

  // --- TRAPS ---
  const trapPositions = [
    { x: 0, y: 0.25, z: 0 },
    { x: -3, y: 0.25, z: 4 },
    { x: 4, y: 0.25, z: -3 },
  ];
  trapPositions.forEach(pos => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.2, 1),
      new THREE.MeshStandardMaterial({ color: 0xff3333 })
    );
    mesh.position.set(pos.x, pos.y, pos.z);
    scene.add(mesh);
    traps.push(mesh);
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.1, 0.5)), position: new CANNON.Vec3(pos.x, pos.y, pos.z) });
    world.addBody(body);
    trapBodies.push(body);
  });

  // --- ROOMBA ---
  const roombaGeo = new THREE.BoxGeometry(1, 0.3, 1);
  const roombaMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
  roomba = new THREE.Mesh(roombaGeo, roombaMat);
  scene.add(roomba);
  roombaBody = new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.15, 0.5)), position: new CANNON.Vec3(4, 0.15, 4) });
  roombaBody.type = CANNON.Body.KINEMATIC;
  world.addBody(roombaBody);
  // Square path (clockwise)
  roombaPath = [
    { x: 4, z: 4 },
    { x: -4, z: 4 },
    { x: -4, z: -4 },
    { x: 4, z: -4 },
  ];
  roombaPathIndex = 0;

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
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// === INPUT ===
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

// === GAME LOOP ===
function animate() {
  requestAnimationFrame(animate);
  if (gameState === 'playing') {
    handleRatMovement();
    moveRoomba();
    checkCollisions();
    world.step(1/60);
    updateObjects();
    updateDashUI();
  }
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
    const speed = 7;
    const vel = ratBody.velocity;
    // Only apply if not already at max speed
    let desired = move.clone().multiplyScalar(speed);
    let diff = new THREE.Vector3(desired.x - vel.x, 0, desired.z - vel.z);
    ratBody.applyForce(new CANNON.Vec3(diff.x * 8, 0, diff.z * 8));
  }
  // Dash
  if (controls.dash && canDash) {
    canDash = false;
    dashCooldown = 3.0;
    dashTimer = 0;
    // Add strong force in last direction
    let dashVec = controls.lastDir.clone().normalize().multiplyScalar(18);
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
  // Move Roomba along path
  let curr = roombaPath[roombaPathIndex];
  let next = roombaPath[(roombaPathIndex + 1) % roombaPath.length];
  let pos = roombaBody.position;
  let dir = { x: next.x - curr.x, z: next.z - curr.z };
  let dist = Math.sqrt(dir.x*dir.x + dir.z*dir.z);
  if (dist > 0) {
    dir.x /= dist; dir.z /= dist;
    let moveStep = roombaSpeed * (1/60);
    pos.x += dir.x * moveStep;
    pos.z += dir.z * moveStep;
    // Check if reached next point
    if (Math.abs(pos.x - next.x) < 0.1 && Math.abs(pos.z - next.z) < 0.1) {
      roombaPathIndex = (roombaPathIndex + 1) % roombaPath.length;
      roombaBody.position.x = next.x;
      roombaBody.position.z = next.z;
    }
  }
}

function updateObjects() {
  // Sync Three.js meshes with Cannon bodies
  rat.position.copy(ratBody.position);
  rat.position.y = 0.5;
  rat.rotation.y = Math.atan2(ratBody.velocity.x, ratBody.velocity.z);
  roomba.position.copy(roombaBody.position);
  roomba.position.y = 0.15;
}

function checkCollisions() {
  // --- Traps ---
  for (let i = 0; i < trapBodies.length; i++) {
    if (checkAABB(ratBody, trapBodies[i], 0.5, [0.5,0.1,0.5])) {
      onDeath('You Died!');
      return;
    }
  }
  // --- Roomba ---
  if (checkAABB(ratBody, roombaBody, 0.5, [0.5,0.15,0.5])) {
    onDeath('You Died!');
    return;
  }
  // --- Human (goal) ---
  if (checkAABB(ratBody, humanBody, 0.5, [0.6,0.7,0.6])) {
    onWin();
    return;
  }
}

function checkAABB(bodyA, bodyB, rA, sizeB) {
  // bodyA: sphere (radius rA), bodyB: box (sizeB = [x,y,z])
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
  showMessage('You Win!');
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
  ratBody.position.set(startPos.x, startPos.y, startPos.z);
  ratBody.velocity.set(0,0,0);
  ratBody.angularVelocity.set(0,0,0);
  // Reset dash
  canDash = true;
  dashCooldown = 0;
  dashTimer = 0;
  // Reset game state
  gameState = 'playing';
  hideMessage();
  restartBtn.classList.add('hidden');
} 