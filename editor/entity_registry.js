import * as THREE from 'three';
import { EntityDef } from '../engine/entity_def.js';
import { GameObject } from '../engine/gameobject.js';
import { MeshRenderer } from '../engine/components/mesh_renderer.js';

function mat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
}

export const ENTITY_DEFS = [
  new EntityDef({
    id: 'cube', name: 'Cube', icon: '■', yOffset: 0.5,
    createObject() {
      const go = new GameObject('Cube');
      go.addComponent(new MeshRenderer(new THREE.BoxGeometry(1, 1, 1), mat(0x7799cc)));
      return go;
    },
  }),
  new EntityDef({
    id: 'cylinder', name: 'Cylinder', icon: '⬡', yOffset: 0.75,
    createObject() {
      const go = new GameObject('Cylinder');
      go.addComponent(new MeshRenderer(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 12), mat(0x77cc99)));
      return go;
    },
  }),
  new EntityDef({
    id: 'sphere', name: 'Sphere', icon: '●', yOffset: 0.5,
    createObject() {
      const go = new GameObject('Sphere');
      go.addComponent(new MeshRenderer(new THREE.SphereGeometry(0.5, 16, 12), mat(0xcc7777)));
      return go;
    },
  }),
  new EntityDef({
    id: 'cone', name: 'Cone', icon: '▲', yOffset: 0.75,
    createObject() {
      const go = new GameObject('Cone');
      go.addComponent(new MeshRenderer(new THREE.ConeGeometry(0.5, 1.5, 12), mat(0xccaa44)));
      return go;
    },
  }),
];
