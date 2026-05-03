import { Component } from '../../engine/gameobject.js';

// Generic building component added to any player-placed structure.
// Provides destroy and move actions in the context menu. The move flow
// removes the building, enters placement mode for the same EntityDef,
// and restores the original if the player cancels.
export class Building extends Component {
  constructor(entityDef) {
    super();
    this._def = entityDef;
  }

  getContextMenu() {
    return {
      title: this._def.name,
      cornerActions: [
        { icon: '🔀', title: 'Move',    onClick: () => this._move() },
        { icon: '🗑️', title: 'Destroy', danger: true, onClick: () => this._destroy() },
      ],
    };
  }

  _destroy() {
    const game = this.gameObject.game;
    const grid = game?.hexGrid;
    if (grid) {
      const pos = this.gameObject.position;
      const hex = grid.worldToHex(pos.x, pos.z);
      grid.free(hex.q, hex.r);
    }
    game?.remove(this.gameObject);
  }

  _move() {
    const game = this.gameObject.game;
    const placement = game?.placement;
    if (!placement) return;

    const def = this._def;
    const oldPos = this.gameObject.position.clone();
    const oldHex = game.hexGrid.worldToHex(oldPos.x, oldPos.z);

    // Remove the building first — frees the hex for validation.
    this._destroy();

    // Enter placement mode. On cancel, restore at old position.
    placement.start(def, () => {/* move is free */}, () => {
      const go = def.createObject(game);
      go.object3D.position.copy(oldPos);
      game.add(go);
      game.hexGrid.occupy(oldHex.q, oldHex.r);
      if (def.entrance) {
        game.hexGrid.setEntrance(oldHex.q, oldHex.r, def.entrance[0], def.entrance[1]);
      }
    });
  }
}
