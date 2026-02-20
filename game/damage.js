import { CFG } from "./config.js";

function safeDiv(a,b){
    if (Math.abs(b) < 1e-6) return a / (b >= 0 ? 1e-6 : -1e-6);
    return a/b;
  }
  function applyPhysicalDamage(raw, armor, armorPenPct) {
    const effArmor = armor * (1 - armorPenPct); // can be negative
    if (effArmor >= 0) {
      // Physical armor nerf:
      // - keep compression model,
      // - but reduce effective pressure and lower hard mitigation cap.
      // This keeps armor useful while preventing late-wave hard walls.
      const armorCompressed = Math.sqrt(effArmor) * 0.85;
      const den = armorCompressed + CFG.DEF_K;
      const red = Math.min(0.62, safeDiv(armorCompressed, den));
      return raw * (1 - red);
    }
    // Negative armor increases damage smoothly without denominator singularities.
    const bonusMul = 1 + (-effArmor / CFG.DEF_K);
    return raw * bonusMul;
  }
  function applyMagicDamage(raw, mr, magicPenFlat) {
    const effMR = (mr - magicPenFlat) * 0.01; // MR etkisi %1'e indirildi
    const den = effMR + CFG.DEF_K;
    const red = safeDiv(effMR, den);
    return raw * (1 - red);
  }

  // =========================================================
  // Map (S path)
  // =========================================================
  
export { safeDiv, applyPhysicalDamage, applyMagicDamage };
