import * as THREE from 'three';

const VS = /* glsl */`
  varying vec2  vWorldUV;
  varying vec3  vWeights;
  varying vec3  vWorldNormal;
  varying float vWorldY;
  varying float vViewDepth;

  uniform float uTiling;

  void main() {
    vec4 worldPos  = modelMatrix * vec4(position, 1.0);
    vWorldUV       = worldPos.xz / uTiling;
    vWeights       = color;
    vWorldNormal   = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vWorldY        = worldPos.y;

    vec4 mvPos     = modelViewMatrix * vec4(position, 1.0);
    vViewDepth     = -mvPos.z;

    gl_Position    = projectionMatrix * mvPos;
  }
`;

const FS = /* glsl */`
  uniform sampler2D uGrassDiff; uniform sampler2D uGrassNor;
  uniform sampler2D uMudDiff;   uniform sampler2D uMudNor;
  uniform sampler2D uPathDiff;  uniform sampler2D uPathNor;
  uniform sampler2D uWetDiff;   uniform sampler2D uWetNor;

  uniform float uWaterY;
  uniform float uNorStrength;
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform vec3  uAmbColor;
  uniform vec3  uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;

  varying vec2  vWorldUV;
  varying vec3  vWeights;      // R=grass  G=mud  B=path
  varying vec3  vWorldNormal;
  varying float vWorldY;
  varying float vViewDepth;

  void main() {
    // ── Splat weights ───────────────────────────────────────────────
    float wGrass = vWeights.r;
    float wMud   = vWeights.g;
    float wPath  = vWeights.b;
    float wWet   = 1.0 - smoothstep(uWaterY, uWaterY + 0.28, vWorldY);
    wWet = max(0.0, wWet);

    float wTotal = wGrass + wMud + wPath + wWet + 0.001;
    wGrass /= wTotal;
    wMud   /= wTotal;
    wPath  /= wTotal;
    wWet   /= wTotal;

    // ── Albedo blend ────────────────────────────────────────────────
    vec3 albedo =
      wGrass * texture2D(uGrassDiff, vWorldUV).rgb +
      wMud   * texture2D(uMudDiff,   vWorldUV).rgb +
      wPath  * texture2D(uPathDiff,  vWorldUV).rgb +
      wWet   * texture2D(uWetDiff,   vWorldUV).rgb;

    // ── Normal map blend ────────────────────────────────────────────
    vec3 nGrass = texture2D(uGrassNor, vWorldUV).rgb * 2.0 - 1.0;
    vec3 nMud   = texture2D(uMudNor,   vWorldUV).rgb * 2.0 - 1.0;
    vec3 nPath  = texture2D(uPathNor,  vWorldUV).rgb * 2.0 - 1.0;
    vec3 nWet   = texture2D(uWetNor,   vWorldUV).rgb * 2.0 - 1.0;
    vec3 tanNor = normalize(wGrass*nGrass + wMud*nMud + wPath*nPath + wWet*nWet);

    // ── TBN — Gram-Schmidt project world-X onto tangent plane ───────
    vec3 N = normalize(vWorldNormal);
    vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
    if (length(T) < 0.001) T = vec3(0.0, 0.0, 1.0);
    T = normalize(T);
    vec3 B = normalize(cross(N, T));
    mat3 TBN = mat3(T, B, N);

    vec3 scaledNor  = vec3(tanNor.xy * uNorStrength, tanNor.z);
    vec3 worldNormal = normalize(TBN * scaledNor);

    // ── Lambert lighting ────────────────────────────────────────────
    float diff = max(0.0, dot(worldNormal, uSunDir));
    vec3 color = albedo * (uAmbColor + uSunColor * diff);

    // ── Linear fog (matches THREE.Fog) ──────────────────────────────
    float fogFactor = smoothstep(uFogNear, uFogFar, vViewDepth);
    color = mix(color, uFogColor, clamp(fogFactor, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
  }
`;

export async function createTerrainMaterial(waterY = -0.28) {
  const loader = new THREE.TextureLoader();
  const load   = (path) => loader.loadAsync(path);

  const [grassD, grassN, mudD, mudN, pathD, pathN, wetD, wetN] = await Promise.all([
    load('assets/textures/dry_ground_01_diff_2k.jpg'),   // grass slot
    load('assets/textures/dry_ground_01_nor_2k.jpg'),
    load('assets/textures/brown_mud_03_diff_2k.jpg'),    // mud slot
    load('assets/textures/brown_mud_03_nor_2k.jpg'),
    load('assets/textures/dirt_floor_diff_2k.jpg'),      // path slot
    load('assets/textures/dirt_floor_nor_2k.jpg'),
    load('assets/textures/brown_mud_03_diff_2k.jpg'),    // wet slot (reuse mud)
    load('assets/textures/brown_mud_03_nor_2k.jpg'),
  ]);

  for (const t of [grassD, grassN, mudD, mudN, pathD, pathN, wetD, wetN]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }

  const FOG_COLOR = new THREE.Color(0xc8a87a);
  const SUN_COLOR = new THREE.Color(0xfff4cc).multiplyScalar(1.4);
  const AMB_COLOR = new THREE.Color(0xffffff).multiplyScalar(0.5);

  return new THREE.ShaderMaterial({
    vertexColors: true,
    uniforms: {
      uGrassDiff:   { value: grassD },
      uGrassNor:    { value: grassN },
      uMudDiff:     { value: mudD },
      uMudNor:      { value: mudN },
      uPathDiff:    { value: pathD },
      uPathNor:     { value: pathN },
      uWetDiff:     { value: wetD },
      uWetNor:      { value: wetN },
      uTiling:      { value: 5.0 },
      uWaterY:      { value: waterY },
      uNorStrength: { value: 0.55 },
      uSunDir:      { value: new THREE.Vector3(15, 30, 10).normalize() },
      uSunColor:    { value: SUN_COLOR },
      uAmbColor:    { value: AMB_COLOR },
      uFogColor:    { value: FOG_COLOR },
      uFogNear:     { value: 55 },
      uFogFar:      { value: 95 },
    },
    vertexShader:   VS,
    fragmentShader: FS,
  });
}
