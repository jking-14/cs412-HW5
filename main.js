const VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;

uniform mat4 uModelView;
uniform mat4 uProjection;

out vec3 vPosition;
out vec3 vNormal;

void main() {
  vec4 p = uModelView * vec4(aPosition, 1.0);
  vPosition = p.xyz;
  vNormal = mat3(uModelView) * aNormal;
  gl_Position = uProjection * p;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in vec3 vPosition;
in vec3 vNormal;

uniform vec3 uLightPos;   // eye space
uniform vec3 uLightPos2;
uniform vec3 uLightPos3;
uniform vec3 uColor;
uniform float uAmbient;
uniform float uDiffuse;
uniform float uSpecular;
uniform float uShininess;

out vec4 fragColor;

void main() {
  vec3 Ka = uAmbient * uColor;
  vec3 Kd = uDiffuse * uColor;
  vec3 Ks = vec3(uSpecular);

  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightPos - vPosition);
  vec3 L2 = normalize(uLightPos2 - vPosition);
  vec3 L3 = normalize(uLightPos3 -vPosition);
  vec3 V = normalize(-vPosition);           // camera sits at the origin
  vec3 R = reflect(-L, N);
  vec3 R2 = reflect(-L2, N);
  vec3 R3 = reflect(-L3, N);

  float diff = max(dot(N, L), 0.0);
  float diff2 = max(dot(N, L2), 0.0);
  float diff3 = max(dot(N, L3), 0.0);
  float spec = pow(max(dot(V, R), 0.0), uShininess);
  float spec2 = pow(max(dot(V, R2), 0.0), uShininess);
  float spec3 = pow(max(dot(V, R3), 0.0), uShininess);

  fragColor = vec4(Ka + Kd * diff + Kd * diff2 + Kd * diff3 + Ks * spec + Ks * spec2 + Ks * spec3, 1.0);
}
`;

// WebGL setup
const canvas = document.getElementById("glcanvas");
const gl = canvas.getContext("webgl2");

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

// Fixed attribute slots, so the meshes stay valid when the shaders are recompiled
const ATTRIBUTES = { aPosition: 0, aNormal: 1 };

function createProgram(vsSource, fsSource) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSource));
  for (const name in ATTRIBUTES) gl.bindAttribLocation(prog, ATTRIBUTES[name], name);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  return prog;
}

// Shader editors
const vertEditor = document.getElementById("vertEditor");
const fragEditor = document.getElementById("fragEditor");
const shaderError = document.getElementById("shaderError");
vertEditor.value = VERTEX_SHADER;
fragEditor.value = FRAGMENT_SHADER;

let program, uModelView, uProjection, uLightPos, uLightPos2, uLightPos3, uColor;
let uAmbient, uDiffuse, uSpecular, uShininess;

function updateProgram() {
  try {
    const prog = createProgram(vertEditor.value, fragEditor.value);
    gl.deleteProgram(program);
    program = prog;
    gl.useProgram(program);
    uModelView = gl.getUniformLocation(program, "uModelView");
    uProjection = gl.getUniformLocation(program, "uProjection");
    uLightPos = gl.getUniformLocation(program, "uLightPos");
    uLightPos2 = gl.getUniformLocation(program, "uLightPos2");
    uLightPos3 = gl.getUniformLocation(program, "uLightPos3");
    uColor = gl.getUniformLocation(program, "uColor");
    uAmbient = gl.getUniformLocation(program, "uAmbient");
    uDiffuse = gl.getUniformLocation(program, "uDiffuse");
    uSpecular = gl.getUniformLocation(program, "uSpecular");
    uShininess = gl.getUniformLocation(program, "uShininess");
    shaderError.textContent = "";
  } catch (e) {
    shaderError.textContent = e.message.replace(/\0/g, "");  // some drivers end the log with \0
  }
}
updateProgram();
vertEditor.addEventListener("input", updateProgram);
fragEditor.addEventListener("input", updateProgram);

function bindAttribute(name, data) {
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.vertexAttribPointer(ATTRIBUTES[name], 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(ATTRIBUTES[name]);
}

function createMesh({ positions, normals, indices }) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  bindAttribute("aPosition", positions);
  bindAttribute("aNormal", normals);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  return { vao, count: indices.length };
}

const cubeMesh = createMesh(createCube());
const cylinderMesh = createMesh(createCylinder(32));

gl.enable(gl.DEPTH_TEST);
gl.clearColor(0, 0, 0, 1);
const projection = perspective(Math.PI / 4, canvas.width / canvas.height, 0.1, 100);
const lightWorld = [3, 4, 5];
const lightWorld2 = [-4, 2, 2];
const lightWorld3 = [0, -3, 3];

// interactive controls
let dragRotX = 0, dragRotY = -0.5;      // mouse drag
let camX = 0, camY = 0, camZ = -7;      // arrow keys, w, s
let sliderAngle = 0;                    // degrees
let spinning = false, spinAngle = 0;    // Start/Stop button
let drilling = false;
let ambientControll = 1.0;
let diffuseControll = 1.0;
let specularControll = 1.0;
let shininessControll = 1.0;

let mouseDown = false, lastX, lastY;
canvas.addEventListener("mousedown", e => { mouseDown = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener("mouseup", () => mouseDown = false);
window.addEventListener("mousemove", e => {
  if (!mouseDown) return;
  dragRotY += (e.clientX - lastX) * 0.01;
  dragRotX += (e.clientY - lastY) * 0.01;
  lastX = e.clientX; lastY = e.clientY;
});

document.addEventListener("keydown", e => {
  if (e.target === vertEditor || e.target === fragEditor) return;  // let the editors use the keys
  const step = 0.2;
  switch (e.key) {
    case "ArrowUp": camY -= step; break;
    case "ArrowDown": camY += step; break;
    case "ArrowLeft": camX += step; break;
    case "ArrowRight": camX -= step; break;
    case "w": camZ += step; break;
    case "s": camZ -= step; break;
    default: return;
  }
  e.preventDefault();  // keep the arrow keys from scrolling the page
});

const axisSelect = document.getElementById("axisSelect");
document.getElementById("slider").addEventListener("input", e => {
  sliderAngle = Number(e.target.value);
  document.getElementById("sliderValue").textContent = sliderAngle;
});
document.getElementById("spinButton").addEventListener("click", () => spinning = !spinning);
document.getElementById("drillButton").addEventListener("click", () => drilling = !drilling);
document.getElementById("ambient").addEventListener("input", e => {
  ambientControll = Number(e.target.value);
  document.getElementById("ambientValue").textContent = ambientControll;
});
document.getElementById("diffuse").addEventListener("input", e => {
  diffuseControll = Number(e.target.value);
  document.getElementById("diffuseValue").textContent = diffuseControll;
});
document.getElementById("specular").addEventListener("input", e => {
  specularControll = Number(e.target.value);
  document.getElementById("specularValue").textContent = specularControll;
});
document.getElementById("shininess").addEventListener("input", e => {
  shininessControll = Number(e.target.value);
  document.getElementById("shininessValue").textContent = shininessControll;
});


function createNode(mesh, color, shape) {
  return { mesh, color, shape, joint: null, children: [], ambient: 0.2, diffuse: 0.8, specular: 0.5, shininess: 32.0 };
}

// Lower arm: scale the cylinder then move it up by 0.6 so its bottom sits at the joint
const lowerArm = createNode(cylinderMesh, [1, 0.2, 0.2],
  multiply(translate(0, 0.6, 0), scale(0.3, 0.6, 0.3)));

// Upper arm: scale the cube then move it up by 0.5 so its bottom sits at the joint
const upperArm = createNode(cubeMesh, [0.2, 0.4, 1],
  multiply(translate(0, 0.5, 0), scale(0.2, 0.5, 0.2)));

lowerArm.children.push(upperArm);

const wrist = createNode(cylinderMesh, [0.2, 0.8, 0.2], multiply(translate(0, 0.3, 0), scale(0.2, 0.3, 0.2)));

upperArm.children.push(wrist);

const hand = createNode(cubeMesh, [1, 0.85, 0.2], multiply(translate(0, 0.5, 0), scale(0.05, 0.5, 0.5)));

wrist.children.push(hand);

lowerArm.diffuse = 0.2;
upperArm.ambient = 0.6;
wrist.specular = 0.1;
hand.shininess = 64.0;

function drawNode(node, frame) {
  gl.uniformMatrix4fv(uModelView, false, multiply(frame, node.shape));
  gl.uniform3fv(uColor, node.color);
  gl.bindVertexArray(node.mesh.vao);
  gl.drawElements(gl.TRIANGLES, node.mesh.count, gl.UNSIGNED_SHORT, 0);

  gl.uniform1f(uAmbient, node.ambient);
  gl.uniform1f(uDiffuse, node.diffuse);
  gl.uniform1f(uSpecular, node.specular);
  gl.uniform1f(uShininess, node.shininess);
}

//Data structure
function drawTree(root, rootFrame) {
  const stack = [[root, rootFrame]];
  while (stack.length > 0) {
    const [node, parentFrame] = stack.pop();
    const frame = multiply(parentFrame, node.joint);
    drawNode(node, frame);
    for (const child of node.children) stack.push([child, frame]);
  }
}

// Render loop
let lastTime = 0;
function render(time) {
  const t = time / 1000;
  if (spinning) spinAngle += t - lastTime;
  lastTime = t;
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Camera moves with the keys; the light stays fixed in the world.
  const view = translate(camX, camY, camZ);
  gl.uniformMatrix4fv(uProjection, false, projection);
  gl.uniform3fv(uLightPos, transformPoint(view, lightWorld));
  gl.uniform3fv(uLightPos2, transformPoint(view, lightWorld2));
  gl.uniform3fv(uLightPos3, transformPoint(view, lightWorld3));

  // Whole-model rotation
  const axisRotation = ROTATE[axisSelect.value](sliderAngle * Math.PI / 180 + spinAngle);
  const rotation = multiply(multiply(rotateY(dragRotY), rotateX(dragRotX)), axisRotation);

  lowerArm.ambient = ambientControll;
  lowerArm.diffuse = diffuseControll;
  lowerArm.specular = specularControll;
  lowerArm.shininess = shininessControll;
  upperArm.ambient = ambientControll;
  upperArm.diffuse = diffuseControll;
  upperArm.specular = specularControll;
  upperArm.shininess = shininessControll;
  wrist.ambient = ambientControll;
  wrist.diffuse = diffuseControll;
  wrist.specular = specularControll;
  wrist.shininess = shininessControll;
  hand.ambient = ambientControll;
  hand.diffuse = diffuseControll;
  hand.specular = specularControll;
  hand.shininess = shininessControll;

  // Lower arm (root)
  lowerArm.joint = multiply(multiply(translate(0, -2, 0), rotation), rotateZ(0.5 * Math.sin(t)));

  // Upper arm (child)
  upperArm.joint = multiply(translate(0, 1.2, 0), rotateZ(Math.sin(1.5 * t)));

  if (drilling) {
    wrist.joint = multiply(translate(0, 1.0, 0), translate(0, -0.1 * Math.sin(12.0 * t), 0));
  } else {
    wrist.joint = multiply(translate(0, 1.0, 0), rotateZ(Math.sin(1.5 * t)));
  }

  if (drilling) {
    hand.joint = multiply(translate(0, 0.6, 0), rotateY(12 * Math.sin(t)));
  } else {
    hand.joint = multiply(translate(0, 0.6, 0), rotateZ(Math.sin(0.5 * t)));
  }

  drawTree(lowerArm, view);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
