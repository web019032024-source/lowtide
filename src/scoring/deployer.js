/* Deployer reputation: 0 (clean) .. 100 (serial rugger). Pure function, unit-tested. */
export function scoreDeployer(d) {
  const n = Math.max(1, d.launches || 0);
  const deadRate = (d.dead_48h || 0) / n, pullRate = (d.lp_pulls || 0) / n, hpRate = (d.honeypots || 0) / n;
  let s = 0;
  s += deadRate * 40;            // launches that died in 48h
  s += pullRate * 40;            // liquidity pulls
  s += hpRate * 50;              // honeypots
  s += Math.min(20, Math.log2(n) * 4);  // volume of launches itself is a tell
  return Math.round(Math.min(100, s));
}
