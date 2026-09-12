---
layout: page
title: Hyperpolygon Moduli Spaces
description:
img:
importance: 2
category: work
---

For a four-punctured sphere, the moduli space of stable flat connections can be described through "hyperpolygons" associated with a balanced representative of the solution. The widget below solves the moment-map equations live in the browser as you vary the parameters; drag to rotate the scene and scroll to zoom. The four β sliders control the parabolic weights. The solution only exists inside a stability chamber — the region where no subset of weights sums to exactly half the total — so the parts of each β slider beyond the nearest chamber wall are blocked out in red (the walls of one slider move as the others change), and dragging stops at the wall.

<div id="hyperpolygon-widget"></div>

<script defer src="{{ '/assets/js/hyperpolygon/lib/three.min.js' | relative_url | bust_file_cache }}"></script>
<script defer src="{{ '/assets/js/hyperpolygon/lib/OrbitControls.js' | relative_url | bust_file_cache }}"></script>
<script type="module" src="{{ '/assets/js/hyperpolygon/widget.js' | relative_url | bust_file_cache }}"></script>