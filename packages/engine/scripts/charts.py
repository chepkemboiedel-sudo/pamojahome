"""Draws the simulation figures from results/. Usage: python3 scripts/charts.py"""
import json
import csv
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROT, WL = "#DB2777", "#6D28D9"          # validated pair (pink = rotation, violet = workload-aware)
INK, MUTED, GRID, BG = "#1E1B3A", "#5B5675", "#E4DCF7", "#FFFFFF"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "text.color": INK,
                     "axes.labelcolor": MUTED, "xtick.color": MUTED, "ytick.color": MUTED,
                     "axes.edgecolor": GRID, "figure.facecolor": BG, "axes.facecolor": BG})

s = json.load(open("results/summary.json"))
scen = list(s.keys())
labels = [s[k]["label"] for k in scen]

panels = [
    ("giniCompleted", "Unevenness of completed work", "Gini (lower is fairer)", False),
    ("boundHeldRate", "Weeks within the fairness bound (gap ≤ E)", "Share of weeks", True),
    ("dislikedShare", "Chores given to someone who dislikes them", "Share of chores", True),
    ("completionRate", "Chores completed", "Share of chores", True),
    ("giniAssigned", "Unevenness of assigned work", "Gini (lower is more even)", False),
    ("overloadedShare", "Members assigned >20% above average", "Share of members", True),
]

fig, axes = plt.subplots(2, 3, figsize=(13, 7.4))
for ax, (key, title, xlabel, pct) in zip(axes.flat, panels):
    y = range(len(scen))
    for off, mode, color, name in [(-0.19, "rotation", ROT, "Basic rotation"), (0.19, "workload", WL, "Workload-aware (missed = ½)")]:
        vals = [s[k]["metrics"][key][mode] for k in scen]
        ax.barh([i + off for i in y], vals, height=0.34, color=color, label=name, edgecolor=BG, linewidth=2)
        for i, v in zip(y, vals):
            ax.text(v, i + off, f"  {v:.0%}" if pct else f"  {v:.3f}", va="center", fontsize=8.5, color=INK)
    ax.set_yticks(list(y), labels if ax in axes[:, 0] else [""] * len(scen))
    ax.invert_yaxis()
    ax.set_title(title, fontsize=10.5, loc="left", color=INK, pad=8)
    ax.set_xlabel(xlabel, fontsize=9)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for sp in ("top", "right", "left"):
        ax.spines[sp].set_visible(False)
    lim = max(s[k]["metrics"][key][m] for k in scen for m in ("rotation", "workload"))
    ax.set_xlim(0, min(lim * 1.28, 1.12) if pct else lim * 1.28)
    if pct and lim > 0.9: ax.set_xticks([0, .25, .5, .75, 1])
    if pct:
        ax.xaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1.0, decimals=0))
handles, names = axes[0, 0].get_legend_handles_labels()
fig.legend(handles, names, loc="upper right", ncol=2, frameon=False, bbox_to_anchor=(0.985, 0.97))
fig.suptitle("Workload-aware allocation vs basic rotation\n2,000 simulated households per scenario, 12 weeks each",
             x=0.01, ha="left", fontsize=12.5, fontweight="bold", color=INK)
fig.tight_layout(rect=(0, 0, 1, 0.92))
fig.savefig("results/fig_metrics.png", dpi=200)

# Per-household paired difference in completed-work Gini (baseline scenario).
rows = [r for r in csv.DictReader(open("results/households.csv")) if r["scenario"] == "baseline"]
rot = {r["household"]: float(r["giniCompleted"]) for r in rows if r["mode"] == "rotation"}
diff = [float(r["giniCompleted"]) - rot[r["household"]] for r in rows if r["mode"] == s["baseline"]["headlineVariant"]]
fig, ax = plt.subplots(figsize=(8, 4.2))
ax.hist(diff, bins=50, color=WL, edgecolor=BG, linewidth=1)
ax.axvline(0, color=INK, linewidth=1.2)
better = sum(d < 0 for d in diff) / len(diff)
ax.text(0.003, ax.get_ylim()[1] * 0.92, "no change", color=INK, fontsize=9)
ax.set_title(f"Workload-aware made completed work more even in {better:.0%} of households",
             loc="left", fontsize=11.5, fontweight="bold", color=INK, pad=10)
ax.set_xlabel("Change in Gini of completed work per available day (workload-aware − rotation; left is fairer)")
ax.set_ylabel("Households")
ax.grid(axis="y", color=GRID, linewidth=0.8)
ax.set_axisbelow(True)
for sp in ("top", "right"):
    ax.spines[sp].set_visible(False)
fig.tight_layout()
fig.savefig("results/fig_paired_difference.png", dpi=200)
print("Wrote results/fig_metrics.png and results/fig_paired_difference.png")

# Trade-off: how much a missed chore counts toward load (0, ½, 1) vs basic rotation.
fig, axes = plt.subplots(1, 4, figsize=(14, 4.4), sharex=True, sharey=True)
for ax, k in zip(axes, scen):
    v = s[k]["variants"]
    xs = [v[n]["metrics"]["giniAssigned"]["workload"] for n in ("workload", "workload_half", "workload_full")]
    ys = [v[n]["metrics"]["giniCompleted"]["workload"] for n in ("workload", "workload_half", "workload_full")]
    ax.plot(xs, ys, color=WL, linewidth=2, zorder=2)
    ax.scatter(xs, ys, s=70, color=WL, edgecolor=BG, linewidth=2, zorder=3, label="Workload-aware")
    for x, y, t in zip(xs, ys, ("missed = 0", "missed = ½", "missed = 1")):
        ax.annotate(t, (x, y), xytext=(7, 4), textcoords="offset points", fontsize=8.5, color=INK)
    rx = s[k]["metrics"]["giniAssigned"]["rotation"]; ry = s[k]["metrics"]["giniCompleted"]["rotation"]
    ax.scatter([rx], [ry], s=70, color=ROT, edgecolor=BG, linewidth=2, zorder=3, label="Basic rotation")
    ax.annotate("rotation", (rx, ry), xytext=(7, 4), textcoords="offset points", fontsize=8.5, color=INK)
    ax.set_title(s[k]["label"], loc="left", fontsize=10.5, color=INK)
    ax.grid(color=GRID, linewidth=0.8); ax.set_axisbelow(True)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    ax.set_xlabel("Unevenness of assigned work (Gini)", fontsize=9)
axes[0].set_ylabel("Unevenness of completed work (Gini)", fontsize=9)
axes[0].set_xlim(0, 0.12); axes[0].set_ylim(0, 0.14)
h, n = axes[0].get_legend_handles_labels()
fig.legend(h, n, loc="upper right", ncol=2, frameon=False, bbox_to_anchor=(0.99, 0.97))
fig.suptitle("How much should a missed chore count? Closer to the bottom-left corner is fairer on both measures",
             x=0.01, ha="left", fontsize=12, fontweight="bold", color=INK)
fig.tight_layout(rect=(0, 0, 1, 0.9))
fig.savefig("results/fig_missed_weight_tradeoff.png", dpi=200)
print("Wrote results/fig_missed_weight_tradeoff.png")
