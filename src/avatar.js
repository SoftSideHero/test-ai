/**
 * Анимации VRM: заметные позы без T-позы.
 * rightUpperArm.z ≈ -1.4 = рука вниз; z≈0 = горизонталь (плохо).
 * Жесты = X/Y плеча + сильный сгиб lowerArm, Z почти не трогаем.
 */
const Z = { rMin: -1.55, rMax: -1.15, lMin: 1.15, lMax: 1.55 };

function clampArm(bone, xyz) {
  const o = xyz.slice();
  if (bone === 'rightUpperArm') o[2] = Math.min(Z.rMax, Math.max(Z.rMin, o[2]));
  if (bone === 'leftUpperArm') o[2] = Math.min(Z.lMax, Math.max(Z.lMin, o[2]));
  return o;
}

const IDLE = {
  rightUpperArm: [0.1, -0.15, -1.42],
  rightLowerArm: [-0.25, 0.1, -0.2],
  rightHand: [0.08, 0.08, 0],
  leftUpperArm: [0.1, 0.15, 1.42],
  leftLowerArm: [-0.25, -0.1, 0.2],
  leftHand: [0.08, -0.08, 0],
  head: [0.04, 0, 0],
  neck: [0, 0, 0],
  spine: [0.03, 0, 0],
  upperChest: [0.03, 0, 0],
  hips: [0, 0, 0],
};

/** Сильно отличающиеся силуэты — иначе «чуть подняла руку на 5°». */
const POSES = {
  idle: { ...IDLE },

  // Рука у подбородка: локоть согнут почти до предела, плечо вперёд/внутрь
  thinking: {
    rightUpperArm: [0.75, -1.05, -1.22],
    rightLowerArm: [-1.85, -0.55, -0.45],
    rightHand: [0.55, 0.35, -0.25],
    leftUpperArm: [0.15, 0.25, 1.38],
    leftLowerArm: [-0.35, -0.1, 0.25],
    head: [0.18, -0.22, 0.22],
    neck: [0.08, -0.1, 0.08],
    upperChest: [0.08, -0.04, 0],
    spine: [0.05, -0.03, 0],
  },

  talking: {
    rightUpperArm: [0.35, -0.55, -1.28],
    rightLowerArm: [-1.15, 0.45, -0.25],
    rightHand: [0.25, 0.35, -0.15],
    leftUpperArm: [0.2, 0.35, 1.34],
    leftLowerArm: [-0.55, -0.2, 0.2],
    head: [0.06, 0.1, -0.06],
    neck: [0.02, 0.04, 0],
    upperChest: [0.05, 0.06, 0],
  },

  working: {
    rightUpperArm: [0.45, -0.65, -1.26],
    rightLowerArm: [-1.35, 0.3, -0.3],
    rightHand: [0.2, 0.2, -0.1],
    leftUpperArm: [0.4, 0.6, 1.26],
    leftLowerArm: [-1.2, -0.25, 0.3],
    head: [0.22, 0, 0],
    neck: [0.12, 0, 0],
    upperChest: [0.1, 0, 0],
    spine: [0.08, 0, 0],
  },

  happy: {
    rightUpperArm: [0.4, -0.4, -1.25],
    rightLowerArm: [-0.85, 0.4, -0.15],
    leftUpperArm: [0.4, 0.4, 1.25],
    leftLowerArm: [-0.85, -0.4, 0.15],
    head: [-0.1, 0, 0],
    upperChest: [-0.02, 0, 0],
  },

  angry: {
    rightUpperArm: [0.25, -0.35, -1.3],
    rightLowerArm: [-0.7, 0.25, -0.2],
    leftUpperArm: [0.25, 0.35, 1.3],
    leftLowerArm: [-0.7, -0.25, 0.2],
    head: [0.1, 0, -0.12],
    neck: [0.04, 0, -0.06],
    upperChest: [0.08, 0, 0],
    spine: [0.06, 0, 0],
  },

  sad: {
    rightUpperArm: [0.2, -0.15, -1.4],
    rightLowerArm: [-0.4, 0.1, -0.15],
    leftUpperArm: [0.2, 0.15, 1.4],
    leftLowerArm: [-0.4, -0.1, 0.15],
    head: [0.28, 0.08, 0.1],
    neck: [0.16, 0.04, 0.05],
    upperChest: [0.1, 0, 0],
    spine: [0.1, 0, 0],
  },

  surprised: {
    rightUpperArm: [0.45, -0.5, -1.22],
    rightLowerArm: [-0.95, 0.35, -0.15],
    leftUpperArm: [0.45, 0.5, 1.22],
    leftLowerArm: [-0.95, -0.35, 0.15],
    head: [-0.14, 0, 0],
    upperChest: [-0.04, 0, 0],
  },
};

/** Мягкие лица: happy у VRM часто сильно щурит глаза — держим низко. */
const FACE = {
  thinking: { relaxed: 0.28, sad: 0.06 },
  talking: { happy: 0.14, relaxed: 0.12 },
  working: { relaxed: 0.22 },
  happy: { happy: 0.28, relaxed: 0.08 },
  angry: { angry: 0.42 },
  sad: { sad: 0.38 },
  surprised: { surprised: 0.4 },
  idle: { relaxed: 0.1 },
  calm: { relaxed: 0.1 },
};

export class AvatarAnim {
  constructor() {
    this.vrm = null;
    this.state = 'idle';
    this.t = 0;
    this.g = 0;
    this.targets = {};
    this.current = {};
  }

  setVRM(vrm) {
    this.vrm = vrm;
    this._seed(IDLE);
    this.setState('idle');
  }

  _seed(pose) {
    this.targets = {};
    this.current = {};
    for (const [b, xyz] of Object.entries(pose)) {
      const c = clampArm(b, xyz);
      this.targets[b] = c.slice();
      this.current[b] = c.slice();
    }
  }

  _setPose(partial) {
    const merged = { ...IDLE, ...partial };
    for (const [b, xyz] of Object.entries(merged)) {
      this.targets[b] = clampArm(b, xyz);
      if (!this.current[b]) this.current[b] = this.targets[b].slice();
    }
  }

  _face(name) {
    if (!this.vrm?.expressionManager) return;
    const em = this.vrm.expressionManager;
    for (const p of ['relaxed', 'sad', 'happy', 'surprised', 'angry']) {
      try {
        em.setValue(p, 0);
      } catch {}
    }
    const vals = FACE[name] || FACE.calm;
    for (const [k, v] of Object.entries(vals)) {
      try {
        em.setValue(k, v);
      } catch {}
    }
  }

  setState(name) {
    if (!name) return;
    if (this.state === name && name !== 'idle') return;
    this.state = name;
    this.g = 0;
    this._setPose(POSES[name] || POSES.idle);
    this._face(name);
  }

  setEmotion(name) {
    this._face(name === 'neutral' ? 'calm' : name);
  }

  update(delta) {
    if (!this.vrm?.humanoid) return;
    const dt = Math.min(0.05, Math.max(0, delta));
    this.t += dt;
    this.g += dt;
    const humanoid = this.vrm.humanoid;
    const t = this.t;
    const st = this.state;

    const add = {};
    const addTo = (b, x, y, z) => {
      if (!add[b]) add[b] = [0, 0, 0];
      add[b][0] += x;
      add[b][1] += y;
      add[b][2] += z;
    };

    const breath = Math.sin(t * 1.5) * 0.02;
    const sway = Math.sin(t * 0.7) * 0.03;
    addTo('spine', breath * 0.6, sway * 0.4, 0);
    addTo('upperChest', breath, sway * 0.5, 0);
    addTo('hips', 0, sway * 0.2, 0);
    addTo('head', Math.sin(t * 0.55) * 0.025, Math.sin(t * 0.4) * 0.035, Math.sin(t * 0.3) * 0.02);

    if (st === 'idle') {
      addTo('rightLowerArm', Math.sin(t * 1.1) * 0.08, 0, 0);
      addTo('leftLowerArm', Math.sin(t * 1.05 + 0.8) * 0.08, 0, 0);
      addTo('rightUpperArm', Math.sin(t * 0.7) * 0.03, Math.sin(t * 0.85) * 0.04, 0);
    }

    if (st === 'thinking') {
      // «хм» — кисть и голова заметно живые
      addTo('rightLowerArm', Math.sin(t * 2.0) * 0.12, Math.sin(t * 1.4) * 0.08, 0);
      addTo('rightHand', Math.sin(t * 2.4) * 0.1, Math.cos(t * 1.8) * 0.08, 0);
      addTo('rightUpperArm', Math.sin(t * 1.2) * 0.05, Math.sin(t * 1.0) * 0.06, 0);
      addTo('head', Math.sin(t * 1.1) * 0.05, 0.05 + Math.sin(t * 0.75) * 0.08, 0.05 + Math.sin(t * 0.6) * 0.06);
    }

    if (st === 'talking') {
      const w = Math.sin(this.g * 2.1);
      const w2 = Math.sin(this.g * 1.5 + 0.7);
      addTo('rightUpperArm', w * 0.06, w2 * 0.1, 0);
      addTo('rightLowerArm', -0.08 + w * 0.22, w2 * 0.1, 0);
      addTo('rightHand', w * 0.12, w2 * 0.1, -w * 0.04);
      addTo('leftLowerArm', Math.sin(this.g * 1.3) * 0.06, 0, 0);
      addTo('head', Math.sin(this.g * 1.7) * 0.028, Math.sin(this.g * 1.3) * 0.04, Math.sin(this.g * 1.0) * 0.022);
      addTo('upperChest', 0, Math.sin(this.g * 1.4) * 0.02, 0);
    }

    if (st === 'working') {
      addTo('rightLowerArm', Math.sin(t * 2.4) * 0.15, Math.sin(t * 1.8) * 0.08, 0);
      addTo('leftLowerArm', Math.sin(t * 2.2 + 1) * 0.15, -Math.sin(t * 1.7) * 0.08, 0);
      addTo('head', 0.04 + Math.sin(t * 1.3) * 0.03, Math.sin(t * 0.9) * 0.04, 0);
    }

    if (st === 'angry') {
      addTo('head', Math.sin(t * 3.0) * 0.02, 0, -0.02 + Math.sin(t * 2.2) * 0.03);
      addTo('upperChest', Math.sin(t * 2.5) * 0.02, 0, 0);
    }

    // thinking догоняет позу быстро
    let speed = 8;
    if (st === 'talking') speed = 6;
    if (st === 'thinking') speed = 10;
    if (st === 'working') speed = 7;
    const alpha = 1 - Math.exp(-speed * dt);

    for (const bone of Object.keys(this.targets)) {
      const target = this.targets[bone];
      if (!this.current[bone]) this.current[bone] = target.slice();
      const cur = this.current[bone];
      const off = add[bone] || [0, 0, 0];
      const desired = clampArm(bone, [
        target[0] + off[0],
        target[1] + off[1],
        target[2] + off[2],
      ]);
      for (let i = 0; i < 3; i++) cur[i] += (desired[i] - cur[i]) * alpha;
      const fin = clampArm(bone, cur);
      cur[0] = fin[0];
      cur[1] = fin[1];
      cur[2] = fin[2];
      try {
        const node = humanoid.getNormalizedBoneNode?.(bone) || humanoid.getBoneNode?.(bone);
        if (node) node.rotation.set(cur[0], cur[1], cur[2]);
      } catch {}
    }
  }
}
