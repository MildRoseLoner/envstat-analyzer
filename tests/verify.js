// 用 Node 运行 EnvStats，与 scipy 参考值逐项比对
const fs = require('fs');
const path = require('path');
const S = require(path.join(__dirname, '..', 'assets', 'js', 'stats.js'));

const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference.json'), 'utf8'));
const d = ref.data, e = ref.expect;

function rel(a, b) {
  if (!isFinite(a) || !isFinite(b)) return Infinity;
  const denom = Math.max(1e-9, Math.abs(b));
  return Math.abs(a - b) / denom;
}

const rows = [];
function check(name, got, want, tol) {
  tol = tol || 1e-6;
  const err = rel(got, want);
  rows.push({ name, got, want, err, ok: err <= tol });
}

const desc = S.describe(d.air);
check('mean', desc.mean, e.desc_air.mean);
check('sd', desc.sd, e.desc_air.sd);
check('median', desc.median, e.desc_air.median);
check('q1', desc.q1, e.desc_air.q1);
check('q3', desc.q3, e.desc_air.q3);
check('skew', desc.skew, e.desc_air.skew);
check('kurt', desc.kurt, e.desc_air.kurt);

const pr = S.pearson(d.air, d.pm10);
check('pearson.r', pr.r, e.pearson.r);
check('pearson.p', pr.p, e.pearson.p, 1e-4);

const lr = S.linreg(d.air, d.pm10);
check('linreg.slope', lr.slope, e.linreg.slope, 1e-5);
check('linreg.intercept', lr.intercept, e.linreg.intercept, 1e-5);
check('linreg.r2', lr.r2, e.linreg.r2, 1e-5);
check('linreg.seSlope', lr.seSlope, e.linreg.se_slope, 1e-5);
check('linreg.p', lr.p, e.linreg.p, 1e-3);

const tw = S.tTest(d.before, d.after, true);
check('welch.t', tw.t, e.ttest_welch.t, 1e-6);
check('welch.p', tw.p, e.ttest_welch.p, 1e-6);

const ts = S.tTest(d.before, d.after, false);
check('student.t', ts.t, e.ttest_student.t, 1e-6);
check('student.p', ts.p, e.ttest_student.p, 1e-6);

const an = S.anova([
  { label: 'A', values: d.g1 },
  { label: 'B', values: d.g2 },
  { label: 'C', values: d.g3 }
]);
check('anova.F', an.F, e.anova.F, 1e-6);
check('anova.p', an.p, e.anova.p, 1e-5);
check('anova.eta2', an.eta2, e.anova.eta2, 1e-5);

const jb = S.jarqueBera(d.air);
check('jarqueBera.stat', jb.stat, e.jarque_bera.stat, 1e-5);
check('jarqueBera.p', jb.p, e.jarque_bera.p, 1e-3);

check('chi2Cdf(3.5,2)', S.chi2Cdf(3.5, 2), 1 - e.chi2_p, 1e-8);
check('tCdf(2.1,17)', S.tCdf(2.1, 17), 1 - e.t_p / 2, 1e-8);
check('fCdf(2.4,3,20)', S.fCdf(2.4, 3, 20), 1 - e.f_p, 1e-8);
check('tQuantile(.975,11)', S.tQuantile(0.975, 11), e.t_crit, 1e-6);

const mk = S.mannKendall(d.trend);
check('mk.senSlope~ols', mk.senSlope, e.mk_trend_slope, 0.12);

let bad = 0;
console.log('检查项'.padEnd(24), '本实现'.padStart(14), 'scipy'.padStart(14), '相对误差');
console.log('-'.repeat(72));
for (const r of rows) {
  if (!r.ok) bad++;
  console.log(
    r.name.padEnd(24),
    String(r.got).slice(0, 14).padStart(14),
    String(r.want).slice(0, 14).padStart(14),
    (r.err < 1e-12 ? '<1e-12' : r.err.toExponential(2)) + (r.ok ? '' : '  ✗')
  );
}
console.log('-'.repeat(72));
console.log(`${rows.length - bad}/${rows.length} 通过`);
process.exit(bad ? 1 : 0);
