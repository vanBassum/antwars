import { Game } from '../engine/game.js';
import { PropLoader } from './prop_loader.js';
import { buildWorld } from './world_builder.js';
import { startSession } from './game_session.js';
import { LEVEL_PROP_MODELS } from './level/zone_generators.js';

await PropLoader.preload([
  'assets/models/leaf.glb',
  'assets/models/glucose_blob.glb',
  ...LEVEL_PROP_MODELS,
]);

const game  = new Game();
const world = await buildWorld(game);
startSession(game, world);
game.start();
