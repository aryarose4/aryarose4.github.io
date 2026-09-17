---
layout: page
title: Hyperpolygon Moduli Spaces
description:
img:
importance: 2
category: work
---

The *four-sided hyperpolygon space* $$\mathcal X(\vec\beta)$$ is the moduli space of stable representations of a four-sided star quiver with dimension vector $$(2,1,1,1,1)$$.  A representation consists of a $$2\times 4$$ matrix $$x$$ with columns $$x_1,\dots,x_4$$, and a $$4\times 2$$ matrix $$y$$ with rows $$y_1,\dots,y_4$$.  The symmetry group $$G = \mathrm{SU}(2)\times\mathrm{U}(1)^4$$ acts in a hamiltonion way, with complex and real moment maps

$$
\mu_{\mathbb C}(x,y)=\Big(\textstyle\sum_{i=1}^{4}x_iy_i,\;\;(y_1x_1,\;\dots,\;y_4x_4)\Big),
$$

$$
\mu_{\mathbb R}(x,y)=\Big(\textstyle\sum_{i=1}^{4}(x_ix_i^\dagger)_0-(y_i^\dagger y_i)_0,\;\;\big(|x_i|^2-|y_i|^2\big)_{i=1}^{4}\Big),
$$

where $$(\cdot)_0$$ denotes the trace-free part.  Then $$\mathcal X(\vec\beta)$$ is the hyperkähler quotient $$\mu_{\mathbb C}^{-1}(0)\,\cap\,\mu_{\mathbb R}^{-1}(\vec\beta)\;\big/\;G$$.  The parameters $$\vec\beta=(\beta_1,\dots,\beta_4)$$ determine the geometry of $$\mathcal X(\vec\beta)$$.

The equation $$\mu_{\mathbb R}(x,y)=(0,\vec\beta)$$ have interpretations in terms of polygons: setting $$v_i=(x_ix_i^\dagger)_0$$ and $$w_i=(y_i^\dagger y_i)_0$$, the $$\mathrm{U}(1)$$ components constrain the side lengths $$\lvert v_i\rvert-\lvert w_i\rvert=\sqrt2\,\beta_i$$, while the $$\mathfrak{su}(2)$$ components give the closure condition $$\sum_i(v_i-w_i)=0$$.  The $$v_i$$'s and $$w_i$$'s assemble to form a polygons in $$\mathfrak{su}(2)\cong\mathbb R^3$$, considered up to $$\mathrm{SO}(3)$$ rotations.

The widget below solves the moment map equations live in the browser as you vary the sliders.  The left view shows the polygon, and the right view depicts the whole four-dimensional moduli space.  Can you find gauge-theoretic descriptions of the various components of $$\mathcal X(\vec\beta)$$?  The definition of stability depends on the chamber of $$\vec\beta$$; moving the $$\vec\beta$$ sliders to a chamber wall gives you the option to cross over.  How does changing chambers affect your answer?

<div id="hyperpolygon-widget"></div>

<script defer src="{{ '/assets/js/hyperpolygon/lib/three.min.js' | relative_url | bust_file_cache }}"></script>
<script defer src="{{ '/assets/js/hyperpolygon/lib/OrbitControls.js' | relative_url | bust_file_cache }}"></script>
<script type="module" src="{{ '/assets/js/hyperpolygon/widget.js' | relative_url | bust_file_cache }}"></script>
