---
layout: page
title: Hyperpolygon Moduli Spaces
description:
img:
importance: 2
category: work
---

The **hyperpolygon space** $$\mathcal X(\vec\beta)$$ is the hyperkähler quotient built from the four-sided quiver: one central vertex carrying $$\mathbb C^2$$ and four legs carrying $$\mathbb C$$, with an arrow $$x_i\colon \mathbb C \to \mathbb C^2$$ and a dual arrow $$y_i\colon \mathbb C^2 \to \mathbb C$$ on each leg ($$i = 1, \dots, 4$$). A representation is a pair of matrices $$(x, y)$$ — $$x$$ of size $$2\times 4$$ with columns $$x_1,\dots,x_4$$, and $$y$$ of size $$4\times 2$$ with rows $$y_1,\dots,y_4$$ — and the gauge group $$G = \mathrm{SU}(2)\times\mathrm{U}(1)^4$$ acts on it: the $$\mathrm{SU}(2)$$ factor at the central vertex, and the $$i$$-th $$\mathrm{U}(1)$$ on leg $$i$$. The action is Hamiltonian, with complex and real moment maps

$$
\mu_{\mathbb C}(x,y)=\Big(\big(\textstyle\sum_{i=1}^{4}x_iy_i\big)_0,\;\;(y_1x_1,\;\dots,\;y_4x_4)\Big),\qquad
\mu_{\mathbb R}(x,y)=\Big(\tfrac12\textstyle\sum_{i=1}^{4}\big((x_ix_i^\dagger)_0-(y_i^\dagger y_i)_0\big),\;\;\tfrac12\big(|x_i|^2-|y_i|^2\big)_{i=1}^{4}\Big)
$$

where $$(\cdot)_0$$ denotes the trace-free part. For stability parameters $$\vec\beta=(\beta_1,\dots,\beta_4)$$ — the values on the $$\beta$$ sliders below — the moduli space is

$$
\mathcal X(\vec\beta)\;=\;\mu_{\mathbb C}^{-1}(0)\,\cap\,\mu_{\mathbb R}^{-1}(\vec\beta)\;\big/\;G,
$$

the space of solutions to the moment-map equations up to gauge equivalence. By the Kempf–Ness theorem this is equally the space of $$\vec\beta$$-stable representations modulo the complexified gauge group $$G_\mathbb C=\mathrm{SL}(2,\mathbb C)\times\mathrm{GL}(1,\mathbb C)^4$$, and it carries a natural hyperkähler structure.

The real moment maps describe polygons. Setting $$v_i=(x_ix_i^\dagger)_0$$ and $$w_i=(y_i^\dagger y_i)_0$$ in $$\mathfrak{su}(2)\cong\mathbb R^3$$, the $$\mathrm{U}(1)$$ moment maps fix the side lengths $$\lvert v_i\rvert-\lvert w_i\rvert=\sqrt2\,\beta_i$$, while the $$\mathfrak{su}(2)$$ moment map is the closure condition $$\sum_i(v_i-w_i)=0$$: the four edges $$v_i$$, closed by the four return edges $$w_i$$, bound a (possibly degenerate) polygon in $$\mathbb R^3$$ — a hyperpolygon.

The widget below solves the moment-map equations live in the browser as you vary the sliders; drag to rotate a view and scroll to zoom. The solution only exists inside a stability chamber — the region where no subset of the $$\beta_i$$ sums to exactly half the total — so the parts of each $$\beta$$ slider beyond the nearest chamber wall are blocked out in red. The moduli coordinates $$(r,\theta,t)$$ place a point inside the chamber, and the side view shows the stratified moduli-space portrait: a central sphere with three exterior spheres attached.

<div id="hyperpolygon-widget"></div>

<script defer src="{{ '/assets/js/hyperpolygon/lib/three.min.js' | relative_url | bust_file_cache }}"></script>
<script defer src="{{ '/assets/js/hyperpolygon/lib/OrbitControls.js' | relative_url | bust_file_cache }}"></script>
<script type="module" src="{{ '/assets/js/hyperpolygon/widget.js' | relative_url | bust_file_cache }}"></script>
