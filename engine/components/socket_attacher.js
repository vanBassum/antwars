import * as THREE from 'three';
import { Component } from '../gameobject.js';

export class SocketAttacher extends Component {
  constructor() {
    super();
    this._sockets = {};
  }

  scanSockets(gltf) {
    this._sockets = {};
    gltf.scene.traverse(obj => {
      if (obj.name.startsWith('SOCKET_')) {
        this._sockets[obj.name] = obj;
      }
    });

    // Log socket world positions so we can tune offsets
    const wp = new THREE.Vector3();
    for (const [name, node] of Object.entries(this._sockets)) {
      node.getWorldPosition(wp);
      console.log(`[socket] ${name}  world pos: x=${wp.x.toFixed(2)} y=${wp.y.toFixed(2)} z=${wp.z.toFixed(2)}`);
    }
  }

  // options: { position, rotation, scale }  — all relative to the socket node
  attach(socketName, object3D, options = {}) {
    const socket = this._sockets[socketName];
    if (!socket) { console.warn(`Socket not found: ${socketName}`); return false; }
    if (options.position) object3D.position.copy(options.position);
    if (options.rotation) object3D.rotation.copy(options.rotation);
    if (options.scale !== undefined) object3D.scale.setScalar(options.scale);
    socket.add(object3D);
    return true;
  }

  detach(socketName, object3D) {
    this._sockets[socketName]?.remove(object3D);
  }

  clear(socketName) {
    const socket = this._sockets[socketName];
    if (!socket) return;
    while (socket.children.length) socket.remove(socket.children[0]);
  }

  get socketNames() { return Object.keys(this._sockets); }
}
