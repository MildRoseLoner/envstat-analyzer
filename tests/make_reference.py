# 生成对照数据：用 numpy 造数组，scipy 计算参考值
import json, numpy as np
from scipy import stats

rng = np.random.default_rng(20261207)

air = np.round(rng.normal(48, 18, 180).clip(3, 260), 1)
pm10 = np.round(air * 1.6 + rng.normal(0, 12, 180), 1)
before = np.round(rng.normal(4.85, 0.92, 36).clip(1.2, 8.5), 2)
after = np.round(rng.normal(2.31, 0.64, 36).clip(0.4, 5.5), 2)
g1 = np.round(rng.normal(78, 6.5, 12), 2)
g2 = np.round(rng.normal(85, 7.2, 12), 2)
g3 = np.round(rng.normal(90, 8.1, 12), 2)
trend = np.round(60 + np.linspace(0, 18, 60) + rng.normal(0, 4, 60), 2)

def desc(a):
    return dict(
        n=int(a.size), mean=float(np.mean(a)), sd=float(np.std(a, ddof=1)),
        median=float(np.median(a)),
        q1=float(np.quantile(a, .25)), q3=float(np.quantile(a, .75)),
        skew=float(stats.skew(a)), kurt=float(stats.kurtosis(a)),
        min=float(a.min()), max=float(a.max()),
    )

r = stats.pearsonr(air, pm10)
lr = stats.linregress(air, pm10)
tt_w = stats.ttest_ind(before, after, equal_var=False)
tt_s = stats.ttest_ind(before, after, equal_var=True)
f, p = stats.f_oneway(g1, g2, g3)
jb = stats.jarque_bera(air)

ssb = sum(len(g) * (np.mean(g) - np.mean(np.concatenate([g1, g2, g3]))) ** 2 for g in (g1, g2, g3))
sst = np.sum((np.concatenate([g1, g2, g3]) - np.mean(np.concatenate([g1, g2, g3]))) ** 2)

out = dict(
    data=dict(air=air.tolist(), pm10=pm10.tolist(), before=before.tolist(),
              after=after.tolist(), g1=g1.tolist(), g2=g2.tolist(), g3=g3.tolist(),
              trend=trend.tolist()),
    expect=dict(
        desc_air=desc(air),
        pearson=dict(r=float(r.statistic), p=float(r.pvalue)),
        linreg=dict(slope=float(lr.slope), intercept=float(lr.intercept),
                    r2=float(lr.rvalue ** 2), se_slope=float(lr.stderr),
                    p=float(lr.pvalue)),
        ttest_welch=dict(t=float(tt_w.statistic), p=float(tt_w.pvalue)),
        ttest_student=dict(t=float(tt_s.statistic), p=float(tt_s.pvalue)),
        anova=dict(F=float(f), p=float(p), eta2=float(ssb / sst)),
        jarque_bera=dict(stat=float(jb.statistic), p=float(jb.pvalue)),
        chi2_p=float(stats.chi2.sf(3.5, 2)),
        t_p=float(2 * stats.t.sf(2.1, 17)),
        f_p=float(stats.f.sf(2.4, 3, 20)),
        t_crit=float(stats.t.ppf(0.975, 11)),
        mk_trend_slope=float(np.polyfit(np.arange(60), trend, 1)[0]),
    )
)
print(json.dumps(out, ensure_ascii=False))
