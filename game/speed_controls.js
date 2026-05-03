// Top-right speed controls: Pause, 1x, 2x, 5x. Sets game.timeScale.
// Pause toggles back to whatever speed was previously selected.

const SPEEDS = [
  { label: '1x', scale: 1 },
  { label: '2x', scale: 2 },
  { label: '5x', scale: 5 },
];

export class SpeedControls {
  constructor(game) {
    this._game = game;
    this._lastSpeed = 1;

    const bar = document.createElement('div');
    bar.className = 'speed-controls';

    this._pauseBtn = document.createElement('button');
    this._pauseBtn.className = 'speed-btn pause-btn';
    this._pauseBtn.textContent = '❚❚';
    this._pauseBtn.title = 'Pause';
    this._pauseBtn.addEventListener('click', () => this._togglePause());
    bar.append(this._pauseBtn);

    this._speedBtns = SPEEDS.map(({ label, scale }) => {
      const btn = document.createElement('button');
      btn.className = 'speed-btn';
      btn.textContent = label;
      btn.dataset.scale = scale;
      btn.addEventListener('click', () => this._setSpeed(scale));
      bar.append(btn);
      return btn;
    });

    document.body.append(bar);
    this._refresh();
  }

  _setSpeed(scale) {
    this._game.timeScale = scale;
    this._lastSpeed = scale;
    this._refresh();
  }

  _togglePause() {
    if (this._game.timeScale === 0) {
      this._game.timeScale = this._lastSpeed || 1;
    } else {
      this._lastSpeed = this._game.timeScale;
      this._game.timeScale = 0;
    }
    this._refresh();
  }

  _refresh() {
    const ts = this._game.timeScale;
    this._pauseBtn.classList.toggle('selected', ts === 0);
    for (const btn of this._speedBtns) {
      btn.classList.toggle('selected', Number(btn.dataset.scale) === ts);
    }
  }
}
