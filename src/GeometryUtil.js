export class GeometryUtil {
    /**
     * Calculate distance between two points
     */
    static distance(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Get total length of a path of points
     */
    static getPathLength(points) {
        let len = 0;
        for (let i = 1; i < points.length; i++) {
            len += this.distance(points[i - 1], points[i]);
        }
        return len;
    }

    /**
     * Resample points to a fixed number of equidistant points
     */
    static resample(points, numPoints = 64) {
        if (points.length <= 1) return points;

        const pathLen = this.getPathLength(points);
        const step = pathLen / (numPoints - 1);

        const newPoints = [points[0]];
        let currentLen = 0;
        let nextStep = step;

        for (let i = 1; i < points.length; i++) {
            let p1 = points[i - 1];
            let p2 = points[i];
            let dist = this.distance(p1, p2);

            while (currentLen + dist >= nextStep) {
                let t = (nextStep - currentLen) / dist;
                let newX = p1.x + (p2.x - p1.x) * t;
                let newY = p1.y + (p2.y - p1.y) * t;
                newPoints.push({ x: newX, y: newY });
                nextStep += step;

                // Safety break if floating point issues cause infinite loop
                if (newPoints.length >= numPoints) break;
            }
            currentLen += dist;
        }

        while (newPoints.length < numPoints) {
            newPoints.push(points[points.length - 1]);
        }

        return newPoints;
    }

    /**
     * Get the centroid (center of mass) of a set of points
     */
    static getCentroid(points) {
        if (!points || points.length === 0) return { x: 0, y: 0 };
        let sumX = 0;
        let sumY = 0;
        for (const p of points) {
            sumX += p.x;
            sumY += p.y;
        }
        return { x: sumX / points.length, y: sumY / points.length };
    }

    /**
     * Compare two strokes. Returns a score (lower is better, 0 is perfect) + its metrics.
     * Now includes translation normalization to be more robust.
     * @param {Array} userPoints - User's drawn points
     * @param {Array} targetPoints - Target stroke points
     * @param {Object} options - Thresholds and weights
     */
    static compareStrokes(userPoints, targetPoints, options = {}) {
        // const {
        //     startDistThreshold = 100,
        //     translationWeight = 0.3, // How much absolute position matters (0-1)
        //     shapeWeight = 0.7,        // How much shape accuracy matters (0-1)
        //     startWeight = 0,
        //     endWeight = 0,
        //     lengthWeight =0
        // } = options;
        const {
            startDistThreshold = 100,
            translationWeight = 0.1, // How much absolute position matters (0-1)
            shapeWeight = 0.45,        // How much shape accuracy matters (0-1)
            startWeight = 0.1,
            endWeight = 0.1,
            lengthWeight =0.1,
            directionWeight = 0.15,
        } = options;

        const resampledUser = this.resample(userPoints);
        const resampledTarget = this.resample(targetPoints);

        // 1. Initial Position Check
        // We still want the stroke to start *somewhere* near the expected start
        const startDist = this.distance(resampledUser[0], resampledTarget[0]);

        // 2. Alignment (Translation Normalization)
        // Calculate centroids
        const userCentroid = this.getCentroid(resampledUser);
        const targetCentroid = this.getCentroid(resampledTarget);

        // Calculate translation cost (distance between centroids)
        const translationCost = this.distance(userCentroid, targetCentroid);

        // 3. Shape Check (Aligned average distance)
        let shapeDist = 0;
        const dx = targetCentroid.x - userCentroid.x;
        const dy = targetCentroid.y - userCentroid.y;

        for (let i = 0; i < resampledUser.length; i++) {
            // Compare user point (shifted to target space) vs target point
            const shiftedUserPoint = {
                x: resampledUser[i].x + dx,
                y: resampledUser[i].y + dy
            };
            shapeDist += this.distance(shiftedUserPoint, resampledTarget[i]);
        }
        const shapeCost = shapeDist / resampledUser.length;

        let totalAngleDist = 0;
        let validPoints = 0;

        for (let i = 1; i < resampledUser.length; i++) {

            const userDx =
                resampledUser[i].x - resampledUser[i - 1].x;

            const userDy =
                resampledUser[i].y - resampledUser[i - 1].y;

            const targetDx =
                resampledTarget[i].x - resampledTarget[i - 1].x;

            const targetDy =
                resampledTarget[i].y - resampledTarget[i - 1].y;

            const userMag = Math.hypot(userDx, userDy);
            const targetMag = Math.hypot(targetDx, targetDy);

            // Avoid division by zero
            if (userMag === 0 || targetMag === 0) {
                continue;
            }

            let cosine =
                (userDx * targetDx + userDy * targetDy) /
                (userMag * targetMag);

            // Protect against floating-point errors
            cosine = Math.max(-1, Math.min(1, cosine));

            const angle = Math.acos(cosine);

            totalAngleDist += angle;
            validPoints++;
        }

        const angleCost =
            validPoints > 0
                ? totalAngleDist / validPoints
                : Math.PI;

        
        const endDist = this.distance(resampledUser.at(-1), resampledTarget.at(-1));

        const userLen = GeometryUtil.getPathLength(userPoints);
        const targetLen = GeometryUtil.getPathLength(targetPoints);
        const ratio = userLen / targetLen;
        const lengthCost = Math.abs(1 - ratio);
        
        // 4. Combined weighted score
        // This is more robust because if you draw the right shape slightly shifted,
        // the shapeCost will be low, and translationCost will be moderate,
        // allowing it to pass even if the absolute coordinates are off.
        // const totalScore = (shapeCost * shapeWeight) + (translationCost * translationWeight);

        const totalScore = (shapeCost * shapeWeight) +
                        (translationCost * translationWeight) +
                        (startDist * startWeight)+
                        (endDist * endWeight) +
                        (angleCost*directionWeight) +
                        (lengthCost * lengthWeight);
        console.log(`Recognition Debug - Shape: ${shapeCost.toFixed(2)}, Trans: ${translationCost.toFixed(2)}, Total: ${totalScore.toFixed(2)}`);
        console.log(`Start Dist: ${startDist}, End Dist: ${endDist}, Angle Cost: ${angleCost}, Length Cost: ${lengthCost}`);

        const result = {score:totalScore,shapeCost: shapeCost, translationCost:translationCost,startDist:startDist,endDist,
            angleCost:angleCost,lengthCost:lengthCost,
        }

        return result;
    }
}
