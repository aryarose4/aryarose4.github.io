---
layout: page
title: Talks
permalink: /talks/
nav: true
nav_order: 3
display_categories: [2026]
horizontal: true
---

<!-- pages/talks.md -->
<div class="projects">
  {% for category in page.display_categories %}
  <a id="{{ category }}" href=".#{{ category }}">
    <h2 class="category">{{ category }}</h2>
  </a>
  {% assign categorized_talks = site.talks | where: "category", category %}
  {% assign sorted_talks = categorized_talks | sort: "importance" %}
  <!-- Generate cards for each talk -->
  {% if page.horizontal %}
  <div class="container">
    <div class="row row-cols-1 row-cols-md-1">
    {% for talk in sorted_talks %}
      {% include talks_horizontal.liquid %}
    {% endfor %}
    </div>
  </div>
  {% else %}
  <div class="row row-cols-1 row-cols-md-3">
    {% for talk in sorted_talks %}
      {% include talks.liquid %}
    {% endfor %}
  </div>
  {% endif %}
  {% endfor %}
</div>