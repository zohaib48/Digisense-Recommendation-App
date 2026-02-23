/**
 * Recommendation Engine
 * Filters and scores products based on size, price, and relevance
 */

/**
 * Filter recommendations based on size and price criteria
 * @param {Array} products - Array of products to filter
 * @param {Object} criteria - Filtering criteria
 * @returns {Array} Filtered and scored recommendations
 */
export function filterRecommendations(products, criteria) {
  const {
    targetSize,
    targetPrice,
    priceRangePercentage = 20,
    maxResults = 8,
    currentProductId
  } = criteria;

  // Calculate price range
  const priceMin = targetPrice * (1 - priceRangePercentage / 100);
  const priceMax = targetPrice * (1 + priceRangePercentage / 100);

  console.log(`\n🎯 Filtering recommendations:`);
  console.log(`   Target Size: ${targetSize}`);
  console.log(`   Target Price: $${targetPrice}`);
  console.log(`   Price Range: $${priceMin.toFixed(2)} - $${priceMax.toFixed(2)}`);
  console.log(`   Products to filter: ${products.length}`);

  // Filter and score products
  const scoredRecommendations = products
    .map(product => {
      // Skip current product
      if (product.id === currentProductId) {
        return null;
      }

      // Find matching variants
      const matchingVariants = findMatchingVariants(
        product.variants,
        targetSize,
        priceMin,
        priceMax
      );

      if (matchingVariants.length === 0) {
        return null;
      }

      // Calculate relevance score
      const relevanceScore = calculateRelevanceScore(
        matchingVariants,
        targetPrice,
        targetSize
      );

      return {
        ...product,
        matchingVariants,
        relevanceScore,
        reason: generateRecommendationReason(
          matchingVariants,
          targetSize,
          targetPrice
        )
      };
    })
    .filter(Boolean) // Remove null entries
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  const recommendations = balanceRecommendationsByPrice(scoredRecommendations, targetPrice, maxResults);

  console.log(`   ✅ Found ${recommendations.length} recommendations\n`);

  return recommendations;
}

function getClosestVariantPrice(variants, targetPrice) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return null;
  }

  return variants.reduce((closest, variant) => {
    if (!closest) return variant;
    const closestDelta = Math.abs(closest.price - targetPrice);
    const currentDelta = Math.abs(variant.price - targetPrice);
    return currentDelta < closestDelta ? variant : closest;
  }, null)?.price ?? null;
}

function balanceRecommendationsByPrice(recommendations, targetPrice, maxResults) {
  if (!Array.isArray(recommendations) || recommendations.length <= 1 || maxResults <= 1) {
    return recommendations.slice(0, maxResults);
  }

  const withDirection = recommendations.map(rec => {
    const closestPrice = getClosestVariantPrice(rec.matchingVariants, targetPrice);
    const direction = closestPrice === null ? 'unknown' : (closestPrice >= targetPrice ? 'above' : 'below');
    return { rec, direction };
  });

  const above = withDirection.filter(item => item.direction === 'above').map(item => item.rec);
  const below = withDirection.filter(item => item.direction === 'below').map(item => item.rec);

  // Ensure at least one recommendation above and below target price when both exist.
  if (above.length === 0 || below.length === 0) {
    return recommendations.slice(0, maxResults);
  }

  const selected = [below[0], above[0]];
  const selectedIds = new Set(selected.map(item => item.id));

  for (const rec of recommendations) {
    if (selected.length >= maxResults) break;
    if (selectedIds.has(rec.id)) continue;
    selected.push(rec);
    selectedIds.add(rec.id);
  }

  return selected;
}

/**
 * Find variants that match size and price criteria
 * @param {Array} variants - Product variants
 * @param {string} targetSize - Target size value
 * @param {number} priceMin - Minimum price
 * @param {number} priceMax - Maximum price
 * @returns {Array} Matching variants
 */
function findMatchingVariants(variants, targetSize, priceMin, priceMax) {
  return variants.filter(variant => {
    // Check if variant is available
    if (!variant.availableForSale) {
      return false;
    }

    // Check price range
    if (variant.price < priceMin || variant.price > priceMax) {
      return false;
    }

    // Check size match (case-insensitive, flexible matching)
    const hasMatchingSize = variant.selectedOptions.some(option => {
      const optionName = option.name.toLowerCase();
      const optionValue = option.value.toLowerCase();
      const targetSizeLower = targetSize.toLowerCase();

      // Check if this is a size option
      if (!['size', 'sizes'].includes(optionName)) {
        return false;
      }

      // Exact match
      if (optionValue === targetSizeLower) {
        return true;
      }

      // Partial match for complex sizes (e.g., "M (38-40)" matches "M")
      if (optionValue.includes(targetSizeLower) || targetSizeLower.includes(optionValue)) {
        return true;
      }

      return false;
    });

    return hasMatchingSize;
  });
}

/**
 * Calculate relevance score for a product
 * Higher score = better recommendation
 * @param {Array} matchingVariants - Variants that match criteria
 * @param {number} targetPrice - Target price
 * @param {string} targetSize - Target size
 * @returns {number} Relevance score (0-100)
 */
function calculateRelevanceScore(matchingVariants, targetPrice, targetSize) {
  if (matchingVariants.length === 0) {
    return 0;
  }

  let score = 50; // Base score

  // Price proximity score (max 25 points)
  const avgPrice = matchingVariants.reduce((sum, v) => sum + v.price, 0) / matchingVariants.length;
  const priceDifference = Math.abs(avgPrice - targetPrice);
  const priceScore = Math.max(0, 25 - (priceDifference / targetPrice) * 25);
  score += priceScore;

  // Availability score (max 15 points)
  const availableCount = matchingVariants.filter(v => v.availableForSale).length;
  const availabilityScore = (availableCount / matchingVariants.length) * 15;
  score += availabilityScore;

  // Exact size match bonus (10 points)
  const hasExactSizeMatch = matchingVariants.some(variant =>
    variant.selectedOptions.some(opt =>
      opt.name.toLowerCase() === 'size' &&
      opt.value.toLowerCase() === targetSize.toLowerCase()
    )
  );
  if (hasExactSizeMatch) {
    score += 10;
  }

  return Math.round(score);
}

/**
 * Generate a human-readable reason for the recommendation
 * @param {Array} matchingVariants - Matching variants
 * @param {string} targetSize - Target size
 * @param {number} targetPrice - Target price
 * @returns {string} Recommendation reason
 */
function generateRecommendationReason(matchingVariants, targetSize, targetPrice) {
  const avgPrice = matchingVariants.reduce((sum, v) => sum + v.price, 0) / matchingVariants.length;
  const priceDiff = avgPrice - targetPrice;
  const priceDiffPercentage = targetPrice > 0 ? (priceDiff / targetPrice) * 100 : 0;
  
  let reason = `Available in size ${targetSize}`;
  
  if (Math.abs(priceDiffPercentage) < 3) {
    reason += `, same price range`;
  } else if (priceDiff < 0) {
    reason += `, ${Math.abs(priceDiffPercentage).toFixed(0)}% cheaper`;
  } else {
    reason += `, ${Math.abs(priceDiffPercentage).toFixed(0)}% higher`;
  }

  return reason;
}

/**
 * Group recommendations by category for better organization
 * @param {Array} recommendations - Array of recommendations
 * @returns {Object} Grouped recommendations
 */
export function groupRecommendations(recommendations) {
  const grouped = {
    exactMatch: [],
    closeMatch: [],
    alternatives: []
  };

  recommendations.forEach(rec => {
    if (rec.relevanceScore >= 80) {
      grouped.exactMatch.push(rec);
    } else if (rec.relevanceScore >= 60) {
      grouped.closeMatch.push(rec);
    } else {
      grouped.alternatives.push(rec);
    }
  });

  return grouped;
}

/**
 * Get size variations available in a product
 * @param {Object} product - Product object
 * @returns {Array} Available sizes
 */
export function getAvailableSizes(product) {
  const sizes = new Set();

  product.variants.forEach(variant => {
    variant.selectedOptions.forEach(option => {
      if (option.name.toLowerCase() === 'size') {
        sizes.add(option.value);
      }
    });
  });

  return Array.from(sizes);
}

/**
 * Get price range for specific size
 * @param {Object} product - Product object
 * @param {string} size - Size to check
 * @returns {Object} Price range for the size
 */
export function getPriceForSize(product, size) {
  const matchingVariants = product.variants.filter(variant =>
    variant.selectedOptions.some(opt =>
      opt.name.toLowerCase() === 'size' &&
      opt.value.toLowerCase() === size.toLowerCase()
    )
  );

  if (matchingVariants.length === 0) {
    return null;
  }

  const prices = matchingVariants.map(v => v.price);
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    avg: prices.reduce((sum, p) => sum + p, 0) / prices.length
  };
}

export default {
  filterRecommendations,
  groupRecommendations,
  getAvailableSizes,
  getPriceForSize,
};
