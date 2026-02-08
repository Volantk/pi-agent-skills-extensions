#!/usr/bin/env node
/**
 * Scraper for iquilezles.org articles
 * Uses Jina Reader API for clean markdown conversion (same as web_read)
 * Usage: node scrape-iq.js [--all | --category <name> | --article <slug>]
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://iquilezles.org/articles/';
const JINA_READER_URL = 'https://r.jina.ai/';
const OUTPUT_DIR = path.join(__dirname, '..', 'sources', 'iquilez', 'articles');

// Article categories and their URLs
const ARTICLES = {
  'sdf-indices': [
    { slug: 'distfunctions', title: '3D SDF Primitives', category: 'sdf' },
    { slug: 'distfunctions2d', title: '2D SDF Primitives', category: 'sdf' },
    { slug: 'smin', title: 'Smooth Minimum', category: 'sdf' },
    { slug: 'sdfrepetition', title: 'Domain Repetition', category: 'sdf' },
    { slug: 'rmshadows', title: 'Soft Shadows', category: 'sdf' },
    { slug: 'normalsSDF', title: 'Numerical Normals', category: 'sdf' },
    { slug: 'interiordistance', title: 'Interior SDFs', category: 'sdf' },
    { slug: 'raymarchingdf', title: 'Raymarching SDFs', category: 'sdf' },
  ],
  'functions': [
    { slug: 'functions', title: 'Useful Functions', category: 'math' },
    { slug: 'smoothsteps', title: 'Smoothstep Functions', category: 'math' },
    { slug: 'intersectors', title: 'Ray-Surface Intersectors', category: 'math' },
    { slug: 'palettes', title: 'Color Palettes', category: 'color' },
  ],
  'noise': [
    { slug: 'fbm', title: 'FBM', category: 'noise' },
    { slug: 'warp', title: 'Domain Warping', category: 'noise' },
    { slug: 'voronoise', title: 'Voronoise', category: 'noise' },
    { slug: 'smoothvoronoi', title: 'Smooth Voronoi', category: 'noise' },
    { slug: 'gradientnoise', title: 'Gradient Noise Derivatives', category: 'noise' },
    { slug: 'morenoise', title: 'Value Noise Derivatives', category: 'noise' },
  ],
  'texturing': [
    { slug: 'filtering', title: 'Filtering Procedurals', category: 'texture' },
    { slug: 'biplanar', title: 'Biplanar Mapping', category: 'texture' },
    { slug: 'texturerepetition', title: 'Texture Repetition', category: 'texture' },
    { slug: 'checkerfiltering', title: 'Checker Filtering', category: 'texture' },
    { slug: 'hwinterpolation', title: 'Hardware Interpolation', category: 'texture' },
  ],
  'lighting': [
    { slug: 'outdoorslighting', title: 'Outdoors Lighting', category: 'lighting' },
    { slug: 'fog', title: 'Better Fog', category: 'lighting' },
    { slug: 'derivative', title: 'Directional Derivative', category: 'lighting' },
  ],
  'optimization': [
    { slug: 'noatan', title: 'Avoiding Trigonometry III', category: 'optimization' },
    { slug: 'sincos', title: 'Avoiding Trigonometry II', category: 'optimization' },
    { slug: 'noacos', title: 'Avoiding Trigonometry I', category: 'optimization' },
    { slug: 'gamma', title: 'Gamma Correct Blurring', category: 'color' },
  ],
  'math': [
    { slug: 'ibilinear', title: 'Inverse Bilinear', category: 'math' },
    { slug: 'ellipsedist', title: 'Distance to Ellipse', category: 'math' },
    { slug: 'triangledistance', title: 'Distance to Triangle', category: 'math' },
    { slug: 'sphereao', title: 'Sphere Ambient Occlusion', category: 'math' },
    { slug: 'boxocclusion', title: 'Box Ambient Occlusion', category: 'math' },
  ],
};

function getAllArticles() {
  const all = [];
  for (const category of Object.values(ARTICLES)) {
    all.push(...category);
  }
  return all;
}

// Fetch via Jina Reader for clean markdown (same approach as web_read tool)
function fetchViaJina(url) {
  return new Promise((resolve, reject) => {
    const jinaUrl = JINA_READER_URL + url;
    
    https.get(jinaUrl, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Clean up Jina output for IQ articles
function cleanContent(markdown) {
  // Remove the header/social links section (before first ### heading)
  const firstSection = markdown.match(/\n### [A-Z]/);
  if (firstSection) {
    const idx = markdown.indexOf(firstSection[0]);
    markdown = markdown.slice(idx);
  }
  
  // Remove footer
  const footerMatch = markdown.match(/\n\[inigo quilez\]\([^)]+\) - learning/i);
  if (footerMatch) {
    markdown = markdown.slice(0, footerMatch.index);
  }
  
  // Format inline code as GLSL code blocks (Jina often returns code without fences)
  // Look for GLSL function signatures and wrap them
  markdown = markdown.replace(/\n((?:float|vec[234]|mat[234]|void|int|bool) \w+\([^)]*\)[^{]*\{[^}]+\})\n/g, '\n```glsl\n$1\n```\n');
  
  // Clean excessive whitespace
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  
  return markdown.trim();
}

async function scrapeArticle(article) {
  const url = `${BASE_URL}${article.slug}`;
  console.log(`  Fetching: ${article.slug}...`);
  
  try {
    // Use Jina Reader for clean markdown conversion
    const rawMarkdown = await fetchViaJina(url);
    
    // Check if we got actual content
    if (rawMarkdown.length < 500) {
      throw new Error('Content too short - may have failed');
    }
    
    const content = cleanContent(rawMarkdown);
    
    const md = `---
source: ${url}
scraped: ${new Date().toISOString().split('T')[0]}
title: "${article.title}"
category: ${article.category}
author: Inigo Quilez
---

# ${article.title}

${content}
`;
    
    return { slug: article.slug, content: md, success: true };
  } catch (err) {
    console.error(`  Error: ${err.message}`);
    return { slug: article.slug, success: false, error: err.message };
  }
}

function saveArticle(slug, content) {
  const filePath = path.join(OUTPUT_DIR, `${slug}.md`);
  fs.writeFileSync(filePath, content, 'utf8');
  const size = Math.round(content.length / 1024);
  console.log(`  Saved: ${slug}.md (${size}KB)`);
}

async function main() {
  const args = process.argv.slice(2);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  
  let articlesToScrape = [];
  
  if (args[0] === '--all') {
    articlesToScrape = getAllArticles();
  } else if (args[0] === '--category' && args[1]) {
    const category = args[1].toLowerCase();
    if (ARTICLES[category]) {
      articlesToScrape = ARTICLES[category];
    } else {
      console.log(`Unknown category: ${category}`);
      console.log(`Available: ${Object.keys(ARTICLES).join(', ')}`);
      process.exit(1);
    }
  } else if (args[0] === '--article' && args[1]) {
    const slug = args[1];
    const all = getAllArticles();
    const article = all.find(a => a.slug === slug);
    articlesToScrape = article ? [article] : [{ slug, title: slug, category: 'other' }];
  } else if (args[0] === '--list') {
    console.log('\nAvailable categories:\n');
    for (const [cat, articles] of Object.entries(ARTICLES)) {
      console.log(`[${cat}]`);
      for (const a of articles) {
        console.log(`  - ${a.slug}: ${a.title}`);
      }
      console.log();
    }
    process.exit(0);
  } else {
    console.log(`
iq Scraper - Fetch iquilezles.org articles as Markdown

Usage:
  node scrape-iq.js --all                    Scrape all curated articles
  node scrape-iq.js --category <name>        Scrape a category  
  node scrape-iq.js --article <slug>         Scrape single article
  node scrape-iq.js --list                   List available articles

Categories: ${Object.keys(ARTICLES).join(', ')}
`);
    process.exit(0);
  }
  
  console.log(`\nScraping ${articlesToScrape.length} articles...\n`);
  
  const results = [];
  for (const article of articlesToScrape) {
    const result = await scrapeArticle(article);
    if (result.success) {
      saveArticle(result.slug, result.content);
      results.push(result);
    }
    await new Promise(r => setTimeout(r, 800));
  }
  
  console.log(`\nDone! Scraped ${results.length}/${articlesToScrape.length} articles.`);
}

main().catch(console.error);
