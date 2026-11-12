// 力导向布局：连线弹簧、节点互斥、向中心收拢；alpha 从 1 衰减到 ALPHA_MIN 停下。
// 拖动时把节点钉在 fx / fy，并把 alphaTarget 提到 0 以上让其余节点跟着动。坐标和距离都是画布(viewBox)单位。

export interface SimNode {
  x: number;
  y: number;
  vx: number;            // 速度(每步的位移)
  vy: number;
  fx: number | null;     // 钉住的位置；null = 不钉
  fy: number | null;
}

export interface SimLink<N extends SimNode> {
  source: N;
  target: N;
  weight: number;     // 实线 1，服务虚线 0.2
}

const DISTANCE = 100;                // 连线的目标长度
const REPULSION = -200;              // 互斥力的强度(负数 = 推开)
const VELOCITY_DECAY = 0.4;          // 每步速度减掉的比例
const ALPHA_MIN = Math.exp(-6);      // alpha 低于它时停下
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / Math.exp(7));   // 每步 alpha 向 alphaTarget 靠近的比例：从 1 降到 ALPHA_MIN 约 e^7 ≈ 1100 步
const CENTER_STRENGTH = 0.1;         // 向中心收拢的强度，横竖两个方向按画布形状分
const SPREAD = 10;                   // 没有位置的节点初始排布的半径步长
const NUDGE = 1e-6;                  // 两点重合时用的位移，免得除以 0

export class Simulation<N extends SimNode> {
  alpha = 1;            // 当前的活跃程度：各个力都乘它
  alphaTarget = 0;      // alpha 趋向的值；大于 0 时模拟不停
  private nodes: N[] = [];
  private links: SimLink<N>[] = [];
  private degree = new Map<N, number>();   // 每个节点连线权重之和
  private center = { x: CENTER_STRENGTH / 2, y: CENTER_STRENGTH / 2 };   // 两个方向的向心强度

  // 换一组节点和连线；没有位置的节点按向日葵排布放在中心附近
  set(nodes: N[], links: SimLink<N>[]): void {
    nodes.forEach((n, i) => {
      if (Number.isFinite(n.x) && Number.isFinite(n.y) && (n.x || n.y)) return;
      const r = SPREAD * Math.sqrt(0.5 + i);
      const a = i * Math.PI * (3 - Math.sqrt(5));
      n.x = r * Math.cos(a);
      n.y = r * Math.sin(a);
    });
    this.nodes = nodes;
    this.links = links;
    this.degree = new Map();
    for (const l of links) for (const n of [l.source, l.target]) this.degree.set(n, (this.degree.get(n) ?? 0) + l.weight);
  }

  // 画布的宽高(只看比例)：越宽横向收拢越弱，图跟着摊成画布的形状；量不到(都是 0)时两个方向一样
  resize(width: number, height: number): void {
    const sum = width + height || 1;
    this.center = { x: CENTER_STRENGTH * (height / sum || 0.5), y: CENTER_STRENGTH * (width / sum || 0.5) };
  }

  get running(): boolean {
    return this.alpha >= ALPHA_MIN || this.alphaTarget > 0;
  }

  // 把 alpha 提到至少这个值，让布局接着动
  restart(alpha: number): void {
    this.alpha = Math.max(this.alpha, alpha);
  }

  // 走一步
  tick(): void {
    this.alpha += (this.alphaTarget - this.alpha) * ALPHA_DECAY;
    const a = this.alpha;
    // 连线：强度 = 权重 / 两端较小的度数；度数大的一端动得少
    for (const l of this.links) {
      const s = l.source;
      const t = l.target;
      const ds = this.degree.get(s) ?? 1;
      const dt = this.degree.get(t) ?? 1;
      let dx = t.x + t.vx - s.x - s.vx || NUDGE;
      let dy = t.y + t.vy - s.y - s.vy || NUDGE;
      const len = Math.hypot(dx, dy);
      const k = ((len - DISTANCE) / len) * a * (l.weight / Math.min(ds, dt));
      dx *= k;
      dy *= k;
      const bias = ds / (ds + dt);
      t.vx -= dx * bias;
      t.vy -= dy * bias;
      s.vx += dx * (1 - bias);
      s.vy += dy * (1 - bias);
    }
    // 互斥：两两之间按距离平方反比
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const p = this.nodes[i]!;
        const q = this.nodes[j]!;
        const dx = q.x - p.x || NUDGE;
        const dy = q.y - p.y || NUDGE;
        const d2 = Math.max(dx * dx + dy * dy, 1);
        const f = (REPULSION * a) / d2;
        p.vx += dx * f;
        p.vy += dy * f;
        q.vx -= dx * f;
        q.vy -= dy * f;
      }
    }
    // 向中心收拢，按速度移动；钉住的节点留在 fx / fy
    for (const n of this.nodes) {
      n.vx -= n.x * this.center.x * a;
      n.vy -= n.y * this.center.y * a;
      if (n.fx !== null && n.fy !== null) {
        n.x = n.fx;
        n.y = n.fy;
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx *= 1 - VELOCITY_DECAY;
      n.vy *= 1 - VELOCITY_DECAY;
      n.x += n.vx;
      n.y += n.vy;
    }
  }
}
