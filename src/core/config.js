/*!
 * 江湖夜雨 · core-runtime · config.js
 * 数值唯一来源：docs/proposals/wuxia-rogue-proposal-v1.md §6（6.1~6.4）
 * 契约：docs/contracts/wuxia-rogue-architecture-v1.md §4.1
 *
 * 约定：
 *  - 本文件是全部数值常量的唯一数值源；玩法/表现模块只读，不得各自写死数字。
 *  - 提案未给出的补充数值在行尾以「补充」注明（半径、粒子数、阈值等量级值）。
 *  - 单位为 px、秒；固定步长 dt = 1/60。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var core = WG.core = WG.core || {};

  core.CONFIG = {
    /* 大地图（proposal §5.1 / §6） */
    world: {
      width: 3840,
      height: 2160,
      margin: 40 // 补充：世界四周钳制边界内缩
    },

    /* 视口（proposal §5.1） */
    viewport: {
      width: 1280,
      height: 720,
      maxZoom: 1.5
    },

    /* 固定步长循环（architecture §4.1 / proposal §5.9） */
    sim: {
      dt: 1 / 60,
      maxSteps: 3,
      maxFrameDt: 0.25 // 补充：单帧时钟上限，防止切后台后死亡螺旋
    },

    /* 空间哈希（proposal §5.9：128 px 网格） */
    spatialHash: {
      cellSize: 128
    },

    /* 相机（proposal §5.1） */
    camera: {
      deadzone: 120,
      smooth: 8, // 平滑系数 8/s
      maxZoom: 1.5,
      shakeAmp: 6, // proposal §5.7 震屏幅度
      shakeDur: 0.25 // proposal §5.7 震屏时长
    },

    /* 单局（proposal §5.8 / §6.3：8 分钟一局；7:30 Boss） */
    run: {
      duration: 480,
      bossTime: 450
    },

    /* 玩家（proposal §6.1） */
    player: {
      radius: 14, // 补充：圆形碰撞体半径（提案未给）
      maxHp: 100,
      speed: 220,
      dash: {
        distance: 120,
        duration: 0.16,
        cooldown: 1.2,
        invuln: 0.18
      },
      atk: 12,
      atkInterval: 0.55,
      atkIntervalMul: 0.97,
      atkIntervalMin: 0.18,
      projectileCount: 1, // Lv8 起 2（见 abilities.doubleShot）
      projectile: {
        range: 340,
        speed: 620,
        pierce: 1,
        radius: 8, // 补充：剑气碰撞半径
        spreadDeg: 18 // proposal §5.3：双剑气间隔 18°
      },
      detectRadius: 170,
      loseRadius: 220,
      pickupRadius: 30,
      pickupRadiusMax: 60,
      magnetRadius: 80,
      magnetRadiusMax: 160,
      magnetSpeed: 260,
      growth: {
        hp: 8,
        heal: 15,
        atk: 2,
        pickupRadius: 2,
        magnetRadius: 2
      }
    },

    /*
     * 升级曲线（proposal §5.6 / §6.4）
     * 提案正文「XP(n→n+1)=40+24n（n 从 1 开始），即 1→2 需 40」按 40+24*(n-1)
     * 解释：Lv1→2 需 40，Lv2→3 需 64，Lv3→4 需 88 …… §6.4 的累计表为叙事近似值，
     * 以本处 base/growth 为唯一计算源（loot 模块据此实现 xpNext(level)）。
     */
    progression: {
      maxLevel: 12,
      xpBase: 40,
      xpGrowth: 24
    },

    /* 里程碑技能（proposal §5.6 / §6.4） */
    abilities: {
      whirl: {
        unlockLevel: 3,
        radius: 95,
        damage: 18,
        interval: 1.5
      },
      swordRain: {
        unlockLevel: 5,
        radius: 420,
        damage: 60,
        interval: 12,
        knockback: 40
      },
      doubleShot: {
        unlockLevel: 8,
        count: 2
      }
    },

    /* 怪物（proposal §6.2 / §5.4） */
    monsters: {
      cap: 300,
      spawnRingMin: 240,
      spawnRingMax: 360,
      hpGrowthPerMin: 0.02,
      damageGrowthPerMin: 0.02,
      growthCap: 0.4,
      speedGrowthPerMin: 2,
      speedGrowthCap: 14,
      eliteCap: 6,
      types: {
        youxia: {
          hp: 30,
          speed: 72,
          damage: 6,
          atkInterval: 1.0,
          xp: 6,
          radius: 14 // 补充
        },
        archer: {
          hp: 22,
          speed: 58,
          damage: 5,
          atkInterval: 1.8,
          xp: 8,
          radius: 13, // 补充
          arrowSpeed: 300,
          keepDistance: 260 // proposal §5.4：保持 260 px
        },
        daoke: {
          hp: 180,
          speed: 62,
          damage: 12,
          atkInterval: 3.0,
          xp: 40,
          radius: 20, // 补充
          chargeWindup: 0.6,
          chargeDistance: 220
        },
        boss: {
          hp: 3000,
          speed: 50,
          damage: 20,
          atkInterval: 2.5,
          xp: 0,
          radius: 36 // 补充
        }
      }
    },

    /* 刷怪导演（proposal §5.4 / §6.3） */
    director: {
      // [秒, 同屏目标数]
      targets: [
        [0, 30],
        [60, 75],
        [180, 110],
        [300, 200],
        [420, 280]
      ],
      spawnFactor: 1.2, // 生成速率 = 目标缺口 × 1.2/s
      spawnRateMin: 1.6,
      spawnRateMax: 12,
      climaxEvery: 60,
      climaxDuration: 8,
      climaxMultiplier: 2,
      eliteEvery: 60
    },

    /* 掉落（proposal §5.5 / §6.2） */
    loot: {
      xpOrb: 6,
      xpElite: 40,
      coinChance: 0.35,
      coinMin: 1,
      coinMax: 3,
      healChance: 0.08,
      healAmount: 25,
      eliteCoinChance: 1.0,
      eliteHealChance: 0.3,
      dropPopTime: 0.25
    },

    /* 对象池容量（proposal §5.9 / architecture §7 实体上限） */
    pools: {
      monsters: 300,
      projectiles: 200,
      enemyProjectiles: 200,
      drops: 150,
      particles: 600,
      damageNumbers: 64
    },

    /* 表现相关数值（proposal §5.7；表现模块只读） */
    fx: {
      bloodParticles: 6,
      hitFlash: 0.08,
      hitKnockback: 8,
      deathAnim: 0.12,
      cullMargin: 96, // 离屏剔除余量
      degradeFps: 50,
      degradeSeconds: 2
    },

    /* 性能预算（proposal §5.9 / architecture §7） */
    perf: {
      targetFps: 60,
      minFps: 45,
      simP95Ms: 6,
      renderP95Ms: 8
    }
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
