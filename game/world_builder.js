import * as THREE from 'three';
import { GameObject } from '../engine/gameobject.js';
import { ModelRenderer } from '../engine/components/model_renderer.js';
import { createTerrain, WATER_Y, setGlobalTerrain } from '../engine/terrain.js';
import { Mover } from '../engine/components/mover.js';
import { DropOff, ResourceNode } from './resources.js';
import { DuckVehicle } from './duck_vehicle.js';
import { buildLevel } from './level/level_builder.js';

function findWaterPos(heightAt) {
  for (let x = -36; x <= 36; x += 1) {
    for (let z = -36; z <= 36; z += 1) {
      if (x * x + z * z < 144) continue;
      if (heightAt(x, z) < WATER_Y - 0.02) return { x, z };
    }
  }
  return null;
}

export async function buildWorld(game) {
  const [layout, rules] = await Promise.all([
    fetch(new URL('../assets/data/backyard_layout.json', import.meta.url)).then(r => r.json()),
    fetch(new URL('../assets/data/generator_rules.json', import.meta.url)).then(r => r.json()),
  ]);

  const { terrainMesh, waterMesh, heightAt, terrainGeo } = await createTerrain(80, 80);
  setGlobalTerrain(heightAt);
  Mover.groundQuery = heightAt;
  game.scene.add(terrainMesh);
  game.scene.add(waterMesh);

  game.scene.background = new THREE.Color(0xc8a87a);
  game.scene.fog = new THREE.Fog(0xc8a87a, 55, 95);

  const anthill = new GameObject('Anthill');
  anthill.addComponent(new ModelRenderer('assets/models/anthill_base_v1.glb'));
  anthill.addComponent(new DropOff('colony'));
  anthill.position.set(0, 0, 0);
  game.add(anthill);

  const sugarNodes = [
    _placeSugar(game, heightAt, 'sugar_source_lollipop_v1.glb',       10, -7),
    _placeSugar(game, heightAt, 'sugar_source_candy_wrapper_v1.glb',  -10, -8),
    _placeSugar(game, heightAt, 'sugar_source_chocolate_bar_v1.glb',    8,  10, 500),
    _placeSugar(game, heightAt, 'sugar_source_honey_dipper_v1.glb',   -11,   9, 600),
    _placeSugar(game, heightAt, 'sugar_source_leaking_soda_v1.glb',    14,   2, 400),
  ];

  const duckPos = findWaterPos(heightAt);
  const duckGO  = new GameObject('RubberDuck');
  duckGO.addComponent(new ModelRenderer('assets/models/rubber_duck_platform_v1.glb'));
  duckGO.addComponent(new DuckVehicle(4));
  if (duckPos) {
    duckGO.position.set(duckPos.x, WATER_Y + 0.12, duckPos.z);
  } else {
    const fx = 20, fz = 20;
    duckGO.position.set(fx, heightAt(fx, fz) + 0.1, fz);
  }
  game.add(duckGO);

  buildLevel(game, layout, rules, terrainGeo, heightAt);

  return { anthill, sugarNodes, duckGO, heightAt };
}

function _placeSugar(game, heightAt, model, x, z, amount = 300) {
  const node = new GameObject('SugarNode');
  node.addComponent(new ModelRenderer(`assets/models/${model}`));
  node.addComponent(new ResourceNode('sugar', amount));
  node.position.set(x, heightAt(x, z), z);
  game.add(node);
  return node;
}
