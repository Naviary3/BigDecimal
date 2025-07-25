
// bigdecimal.ts

/**
 * High performance arbitrary-precision decimal type of Javascript.
 * https://github.com/Naviary2/BigDecimal
 * 
 * Use Big Decimals when you not only need the arbitrary size of BigInts,
 * but also decimals to go with them!
 * 
 * It is in base 2, so most base-10 numbers can't be represented perfectly.
 */


import bigintmath from './bigintmath.js';


// Types ========================================================


/** 
 * The main Big Decimal type. Capable of storing arbitrarily large numbers,
 * with arbitrary levels of decimal precision!
 */
interface BigDecimal {
	/**
	 * The bigint storing the bits of the BigDecimal. Multiply this
	 * by 2 ^(-divex) to get the true number being stored by the Big Decimal!
	 */
    bigint: bigint,
	/**
	 * The inverse exponent. Directly represents how many bits of the
	 * bigint are utilized to store the decimal portion of the Big Decimal.
	 */
    divex: number,
}


// Constants ========================================================


const LOG_TWO: number = Math.log(2);
const ZERO: bigint = 0n;
const ONE: bigint = 1n;
const FIVE: bigint = 5n;


// Config ===========================================================


/**
 * The default additional number of bits used as working precision
 * for all Big Decimals, on top of the minimum precision needed for
 * the true value to round to the desired value.
 * 
 * The minimum number of bits used to store decimal bits in BigDecimals.
 * Without working precision, small numbers parsed into BigDecimals would lose some precision.
 * For example, 3.1 divex 4 ==> 3.125. Now even though 3.125 DOES round to 3.1,
 * it means we'll very quickly lose a lot of accuracy when performing arithmetic!
 * The user expects that, when they pass in 3.1, the resulting BigDecimal should be AS CLOSE to 3.1 as possible!!
 * With a DEFAULT_WORKING_PRECISION of 50 bits, 3.1 divex 50 ==> 3.10000000000000142, which is A LOT closer to 3.1!
 * I arbitrarily chose 50 bits for the minimum, because that gives us about 15 digits of precision,
 * which is about how much javascript's doubles give us.
 */
const DEFAULT_WORKING_PRECISION: number = 50; // Default: 50

/**
 * The maximum divex a BigDecimal is allowed to have.
 * Beyond this, the divex is assumed to be running away towards Infinity, so an error is thrown.
 * Can be adjusted if you want more maximum precision.
 */
const MAX_DIVEX: number = 1e3; // Default: 1e3 (1,000)

/** A list of powers of 2, 1024 in length, starting at 1 and stopping before Number.MAX_VALUE. This goes up to 2^1023. */
const powersOfTwoList: number[] = (() => {
    const powersOfTwo: number[] = [];
    let currentPower = 1
    while (currentPower < Number.MAX_VALUE) {
        powersOfTwo.push(currentPower)
        currentPower *= 2;
    }
    return powersOfTwo;
})();

/**
 * Any divex greater than 1023 can lead to Number casts (of the decimal portion)
 * greater than Number.MAX_VALUE or equal to Infinity, because 1 * 2^1024 === Infinity,
 * but 1 * 2^1023 does NOT. And 1.0 encompasses all possible fractional values!
 * BigDecimals with divexs THAT big need special care!
 */
const MAX_DIVEX_BEFORE_INFINITY: number = powersOfTwoList.length - 1; // 1023


// Helpers ====================================================================


/**
 * Returns the specified bigint power of 2 when called.
 * This has a dynamic internal list that, when a power of 2 is requested that is does not have,
 * it will calculate more powers of 2 up to the requested power!
 * @param power - The power of 2 to retrieve
 * @returns The bigint power of 2 requested
 */
const getBigintPowerOfTwo: (power: number) => bigint = (function() {

    // Initiate the list
    const powersOfTwo: bigint[] = []
    let currentPower: bigint = ONE
    const MAX_VALUE: bigint = BigInt(Number.MAX_VALUE)
    while (currentPower < MAX_VALUE) {
        powersOfTwo.push(currentPower)
        currentPower <<= ONE;
    }

    // Adds more powers of 2 until we reach the provided power
    function addMorePowers(powerCap: number): void {
        console.log(`Adding more bigint powers of 2, up to 2^${powerCap}!`)
        for (let i = powersOfTwo.length - 1; i <= powerCap - 1; i++) {
            const thisPower = powersOfTwo[i];
            powersOfTwo[i+1] = thisPower << ONE;
        }
    }

    // Return a function that, when called, returns the specified power of 2
    return (power: number): bigint => {
        // Do we have enough powers of two in store?
        if (power > powersOfTwo.length - 1) addMorePowers(power);
        return powersOfTwo[power];
    }
})();


// Big Decimal Contructor =============================================================


/**
 * Creates a Big Decimal from a string (arbitrarily long)
 * "1905000302050000000000000000000000000000000000.567"
 * The final precision is calculated dynamically to preserve the input string's
 * precision, plus a "working precision" for future calculations.
 * @param num The string to convert.
 * @param [workingPrecision=DEFAULT_WORKING_PRECISION] The amount of extra precision to add.
 * @returns A new BigDecimal with the value from the string.
 */
function NewBigDecimal_FromString(num: string, workingPrecision: number = DEFAULT_WORKING_PRECISION): BigDecimal {
    if (workingPrecision < 0 || workingPrecision > MAX_DIVEX) throw new Error(`Precision must be between 0 and ${MAX_DIVEX}. Received: ${workingPrecision}`);

    const dotIndex: number = num.lastIndexOf('.');
    const decimalDigitCount: number = dotIndex !== -1 ? num.length - dotIndex - 1 : 0;

    // 1. Calculate the minimum bits needed to represent the input string's fractional part.
    const minBitsForInput: number = howManyBitsForDigitsOfPrecision(decimalDigitCount);

    // 2. The final divex is this minimum, plus the requested "working precision".
    //    This ensures we always have enough precision for the input, plus a buffer for future math.
    const divex: number = minBitsForInput + workingPrecision;
    // Check if the calculated divex is within our library's limits.
    if (divex > MAX_DIVEX) throw new Error(`Precision after applying working precision exceeded ${MAX_DIVEX}. Please use an input number with fewer decimal places or specify less working precision.`);

    // 1. Calculate 5^N.
    const powerOfFive: bigint = FIVE ** BigInt(decimalDigitCount);

    // 2. Make the string an integer.
    if (dotIndex !== -1) num = num.slice(0, dotIndex) + num.slice(dotIndex + 1);
    let numberAsBigInt: bigint = BigInt(num);

    // 3. Scale the integer by the necessary power of 2.
    // The total scaling is 2^(divex - decimalDigitCount).
    const shiftAmount = BigInt(divex - decimalDigitCount);
    if (shiftAmount > 0) numberAsBigInt <<= shiftAmount;
    else if (shiftAmount < 0) numberAsBigInt >>= -shiftAmount; // A negative shift is a right shift.

    // 4. Finally, perform the division by the power of 5.
    const bigint: bigint = numberAsBigInt / powerOfFive;
    
    return {
        bigint,
        divex,
    };
}

/**
 * Creates a Big Decimal from a javascript number (double)
 * @param num - The number to convert.
 * @param [workingPrecision=DEFAULT_WORKING_PRECISION] The amount of extra precision to add.
 * @returns A new BigDecimal with the value from the number.
 */
function NewBigDecimal_FromNumber(num: number, precision: number = DEFAULT_WORKING_PRECISION): BigDecimal {
    if (!isFinite(num)) throw new Error(`Cannot create a BigDecimal from a non-finite number. Received: ${num}`);
    if (precision < 0 || precision > MAX_DIVEX) throw new Error(`Precision must be between 0 and ${MAX_DIVEX}. Received: ${precision}`);

    const fullDecimalString = toFullDecimalString(num);
    return NewBigDecimal_FromString(fullDecimalString, precision);
}

/**
 * Creates a Big Decimal from a bigint and a desired precision level.
 * @param num
 * @param [workingPrecision=DEFAULT_WORKING_PRECISION] The amount of extra precision to add.
 * @returns A new BigDecimal with the value from the bigint.
 */
function NewBigDecimal_FromBigInt(num: bigint, precision: number = DEFAULT_WORKING_PRECISION): BigDecimal {
    if (precision < 0 || precision > MAX_DIVEX) throw new Error(`Precision must be between 0 and ${MAX_DIVEX}. Received: ${precision}`);
    return {
        bigint: num << BigInt(precision),
        divex: precision,
    }
}


// Helpers ===========================================================================================


/**
 * Converts a finite number to a string in full decimal notation, avoiding scientific notation.
 * This method is reliable for all finite numbers, correctly handling all edge cases.
 * @param num The number to convert.
 * @returns The number in decimal format as a string.
 * @throws {Error} If the input is not a finite number (e.g., Infinity, -Infinity, or NaN).
 */
function toFullDecimalString(num: number): string {
    // 1. Input Validation: Fail fast for non-finite numbers.
    if (!Number.isFinite(num)) throw new Error(`Cannot decimal-stringify a non-finite number. Received: ${num}`);

	// 2. Optimization: Handle numbers that don't need conversion.
	const numStr: string = String(num);
	if (!numStr.includes('e')) return numStr;

	// 3. Deconstruct the scientific notation string.
	const [base, exponentStr] = numStr.split('e');
	const exponent: number = Number(exponentStr);
	const sign: string = base[0] === '-' ? '-' : '';
	const absBase: string = base.replace('-', '');
	const [intPart, fracPart = ''] = absBase.split('.');

	// 4. Reconstruct the string based on the exponent.
	if (exponent > 0) { // For large numbers
		if (exponent >= fracPart.length) {
			// Case A: The decimal point moves past all fractional digits.
			// e.g., 1.23e5 -> 123000
			const allDigits = intPart + fracPart;
			const zerosToPad = exponent - fracPart.length;
			return sign + allDigits + '0'.repeat(zerosToPad);
		} else {
			// Case B: The decimal point lands within the fractional digits.
			// e.g., 1.2345e2 -> 123.45
			const decimalIndex = intPart.length + exponent;
			const allDigits = intPart + fracPart;
			const left = allDigits.slice(0, decimalIndex);
			const right = allDigits.slice(decimalIndex);
			return sign + left + '.' + right;
		}
	} else { // For small numbers (exponent < 0)
		const numLeadingZeros = -exponent - 1;
		const allDigits = intPart + fracPart;
		return sign + '0.' + '0'.repeat(numLeadingZeros) + allDigits;
	}
}

/**
 * Returns the mimimum number of bits you need to get the specified digits of precision, rounding up.
 * 1 decimal digit of precision ≈ 3.32 binary bits of precision.
 * 
 * For example, to have 3 decimal places of precision in a BigDecimal, or precision to the nearest thousandth,
 * call this function with precision `3`, and it will return `10` to use for the divex value of your BigDecimal, because 2^10 ≈ 1000
 * 
 * HOWEVER, it is recommended to add some constant amount of extra precision to retain accuracy!
 * 3.1 divex 4 ==> 3.125. Now even though 3.125 DOES round to 3.1,
 * performing our arithmetic with 3.125 will quickly divexiate inaccuracies!
 * If we added 30 extra bits of precision, then our 4 bits of precision
 * becomes 34 bits. 3.1 divex 34 ==> 3.099999999976717... which is a LOT closer to 3.1!
 * @param precision - The number of decimal places of precision you would like
 * @returns The minimum number of bits needed to obtain that precision, rounded up.
 */
function howManyBitsForDigitsOfPrecision(precision: number): number {
	const powerOfTen: number = 10**precision; // 3 ==> 1000
	// 2^x = powerOfTen. Solve for x
	const x: number = Math.log(powerOfTen) / LOG_TWO;
	return Math.ceil(x)
}


// Math and Arithmetic Methods ==================================================================

/**
 * Adds two BigDecimal numbers.
 * The resulting BigDecimal will have a divex equal to the maximum divex of the two operands to prevent precision loss.
 * @param bd1 - The first addend.
 * @param bd2 - The second addend.
 * @returns The sum of bd1 and bd2.
 */
function add(bd1: BigDecimal, bd2: BigDecimal): BigDecimal {
	// To add, both BigDecimals must have the same divex (common denominator).
	// We'll scale the one with the lower divex up to match the higher one.

	if (bd1.divex === bd2.divex) {
		// Exponents are the same, a simple bigint addition is sufficient.
		return {
			bigint: bd1.bigint + bd2.bigint,
			divex: bd1.divex
		};
	} else if (bd1.divex > bd2.divex) {
		// Scale up bd2 to match bd1's divex
		const bd2DivexAdjusted = bd2.bigint << BigInt(bd1.divex - bd2.divex);
		return {
			bigint: bd1.bigint + bd2DivexAdjusted,
			divex: bd1.divex
		};
	} else { // divex2 > divex1
		// Scale up bd1 to match bd2's divex
		const bd1DivexAdjusted = bd1.bigint << BigInt(bd2.divex - bd1.divex);
		return {
			bigint: bd1DivexAdjusted + bd2.bigint,
			divex: bd2.divex
		};
	}
}

/**
 * Subtracts the second BigDecimal from the first.
 * The resulting BigDecimal will have a divex equal to the maximum divex of the two operands to prevent precision loss.
 * @param bd1 - The minuend.
 * @param bd2 - The subtrahend.
 * @returns The difference of bd1 and bd2 (bd1 - bd2).
 */
function subtract(bd1: BigDecimal, bd2: BigDecimal): BigDecimal {
	// To subtract, both BigDecimals must have the same divex (common denominator).
	// We scale the one with the lower divex up to match the higher one.

	if (bd1.divex === bd2.divex) {
		// Exponents are the same, a simple bigint subtraction is sufficient.
		return {
			bigint: bd1.bigint - bd2.bigint,
			divex: bd1.divex
		};
	} else if (bd1.divex > bd2.divex) {
		// Scale up bd2's bigint to match bd1's divex
		const bd2BigIntAdjusted = bd2.bigint << BigInt(bd1.divex - bd2.divex);
		return {
			bigint: bd1.bigint - bd2BigIntAdjusted,
			divex: bd1.divex
		};
	} else { // bd2.divex > bd1.divex
		// Scale up bd1's bigint to match bd2's divex
		const bd1BigIntAdjusted = bd1.bigint << BigInt(bd2.divex - bd1.divex);
		return {
			bigint: bd1BigIntAdjusted - bd2.bigint,
			divex: bd2.divex
		};
	}
}

/**
 * Multiplies two BigDecimal numbers.
 * @param bd1 - Factor1
 * @param bd2 - Factor2
 * @param mode - The mode for determining the new divex.
 * - `0` (default): Uses the maximum divex of the two factors.
 * - `1`: Uses the sum of the factors' divexs for full precision.
 * - `2`: Uses the minimum divex of the two factors.
 * @returns The product of BigDecimal1 and BigDecimal2.
 */
function multiply(bd1: BigDecimal, bd2: BigDecimal, mode: 0 | 1 | 2 = 0): BigDecimal {
	const targetDivex: number = 
		mode === 0 ? Math.max(bd1.divex, bd2.divex)  // Max
		: mode === 1 ? bd1.divex + bd2.divex           // Add
		:              Math.min(bd1.divex, bd2.divex); // Min

	// The true divex of the raw product is (bd1.divex + bd2.divex).
	// We shift the raw product to scale it to the targetDivex.
	const shiftAmount = BigInt((bd1.divex + bd2.divex) - targetDivex);

	return {
		bigint: (bd1.bigint * bd2.bigint) >> shiftAmount,
		divex: targetDivex,
	};
}

/**
 * Divides the first BigDecimal by the second, producing a result with a predictable divex.
 * The final divex is determined by the maximum of the inputs' divex.
 * This prevents the divex from growing uncontrollably with repeated divisions.
 * @param bd1 - The dividend.
 * @param bd2 - The divisor.
 * @param [workingPrecision=DEFAULT_WORKING_PRECISION] - Extra bits for internal calculation to prevent rounding errors.
 * @returns The quotient of bd1 and bd2 (bd1 / bd2).
 * @throws {Error} If attempting to divide by zero.
 */
function divide(bd1: BigDecimal, bd2: BigDecimal, workingPrecision: number = DEFAULT_WORKING_PRECISION): BigDecimal {
	if (bd2.bigint === ZERO) throw new Error("Division by zero is not allowed.");

	// 1. Determine the predictable, final divex for the result.
	const targetDivex = Math.max(bd1.divex, bd2.divex);

	// 2. Calculate the total shift needed for the dividend. This includes:
	//    - The shift to get to the target precision.
	//    - The extra "workingPrecision" to ensure accuracy during division.
	const shift = BigInt(targetDivex - bd1.divex + bd2.divex + workingPrecision);

	// 3. Scale the dividend up.
	const scaledDividend = bd1.bigint << shift;

	// 4. Perform the integer division. The result has `workingPrecision` extra bits.
	const quotient = scaledDividend / bd2.bigint;
	
	// 5. Round the result by shifting it back down by `workingPrecision`.
	//    We check the most significant bit of the part being discarded to round correctly.
	const roundingBit = (quotient >> BigInt(workingPrecision - 1)) & ONE;
	let finalQuotient = quotient >> BigInt(workingPrecision);
	if (roundingBit === ONE) finalQuotient++;

	return {
		bigint: finalQuotient,
		divex: targetDivex
	};
}

/**
 * Returns a new BigDecimal that is the absolute value of the provided BigDecimal.
 * @param bd - The BigDecimal.
 * @returns A new BigDecimal representing the absolute value.
 */
function abs(bd: BigDecimal): BigDecimal {
	// The sign is determined solely by the bigint.
	// The divex (scale) remains the same.
	// We return a new object and do not modify the original.
	return {
		bigint: bd.bigint < ZERO ? -bd.bigint : bd.bigint,
		divex: bd.divex
	};
}

/** Returns a deep copy of the original big decimal. */
function clone(bd: BigDecimal): BigDecimal {
	return {
		bigint: bd.bigint,
		divex: bd.divex,
	};
}

/**
 * Modifies the BigDecimal to have the specified divex, always rounding to the nearest value.
 * This is consistent with the "round half up" method used elsewhere in the library.
 * @param bd The BigDecimal to modify.
 * @param divex The target divex.
 */
function setExponent(bd: BigDecimal, divex: number): void {
    if (divex < 0 || divex > MAX_DIVEX) throw new Error(`Divex must be between 0 and ${MAX_DIVEX}. Received: ${divex}`);

    const difference = bd.divex - divex;

    // If there's no change, do nothing.
    if (difference === 0) return;

    // If the difference is negative, we are increasing precision (shifting left).
    // This is a pure scaling operation and never requires rounding.
    if (difference < 0) {
        bd.bigint <<= BigInt(-difference);
        bd.divex = divex;
        return;
    }

    // We are now decreasing precision (shifting right), so we must round.

    // To "round half up", we add 0.5 before truncating.
    // "0.5" relative to the part being discarded is 1 bit shifted by (difference - 1).
    const half = ONE << BigInt(difference - 1);
    
    bd.bigint += half;
    bd.bigint >>= BigInt(difference);
    bd.divex = divex;
}

/**
 * Compares two BigDecimals.
 * @param bd1 The first BigDecimal.
 * @param bd2 The second BigDecimal.
 * @returns -1 if bd1 < bd2, 0 if bd1 === bd2, and 1 if bd1 > bd2.
 */
function compare(bd1: BigDecimal, bd2: BigDecimal): -1 | 0 | 1 {
    // To compare, we must bring them to a common divex, just like in add/subtract.
    // However, we don't need to create new objects.

    let bigint1 = bd1.bigint;
    let bigint2 = bd2.bigint;

    if (bd1.divex > bd2.divex) {
        // Scale up bd2 to match bd1's divex.
        bigint2 <<= BigInt(bd1.divex - bd2.divex);
    } else if (bd2.divex > bd1.divex) {
        // Scale up bd1 to match bd2's divex.
        bigint1 <<= BigInt(bd2.divex - bd1.divex);
    }
    // If divex are equal, no scaling is needed.

    // Now that they are at the same scale, we can directly compare the bigints.
    if (bigint1 < bigint2) return -1;
    if (bigint1 > bigint2) return 1;
    return 0;
}


// Conversions & Utility ====================================================================


/**
 * Converts a BigDecimal to a BigInt, always rounding to the nearest integer.
 * This uses "round half up" (towards positive infinity).
 * For example, 2.5 becomes 3, and -2.5 becomes -2.
 * @param bd The BigDecimal to convert.
 * @returns The rounded BigInt value.
 */
function toBigInt(bd: BigDecimal): bigint {
	// If divex is 0, the number is already a correctly scaled integer.
	if (bd.divex === 0) return bd.bigint;

	const divexBigInt = BigInt(bd.divex);

	// To "round half up", we add 0.5 before truncating.
	// In our fixed-point system, "0.5" is represented by 2^(divex - 1).
	const half = ONE << (divexBigInt - ONE);
	
	// Add half and then truncate. The arithmetic right shift `>>` handles truncation
	// correctly for both positive and negative numbers.
	const adjustedBigInt = bd.bigint + half;
	
	return adjustedBigInt >> divexBigInt;
}

/**
 * Converts a BigDecimal to a number (javascript double).
 * This conversion is lossy if the BigDecimal's precision exceeds that of a 64-bit float.
 * If the value exceeds Number.MAX_VALUE, it will correctly return Infinity or -Infinity.
 * @param bd - The BigDecimal to convert.
 * @returns The value as a standard javascript number.
 */
function toNumber(bd: BigDecimal): number {
	const divexBigInt = BigInt(bd.divex);

	// 1. Separate the integer part without losing any precision yet.
	const integerPart = bd.bigint >> divexBigInt;

	// 2. Isolate the fractional bits. This also works correctly for negative numbers.
	const fractionalPartShifted = bd.bigint - (integerPart << divexBigInt);
	// Alternative line, around 10-20% slower:
	// const fractionalPartShifted = bigintmath.getLeastSignificantBits(bd.bigint, divex_bigint)

	// 3. Convert the integer part to a number. This can become Infinity if it's too large.
	const numberResult = Number(integerPart);

	// If the integer part is already +/- Infinity, the fractional part is irrelevant.
	if (!Number.isFinite(numberResult)) return numberResult;
	
	// 4. Convert the fractional part to a number.
	// We use a MAXIMUM precision (1023 bits) to avoid overflow during this cast.
	const MAX_BITS_FOR_FRACTIONAL_CAST = MAX_DIVEX_BEFORE_INFINITY; // 1023
	let decimalPartAsNumber: number;
	let finalExponent: number = -bd.divex;

	if (bd.divex <= MAX_BITS_FOR_FRACTIONAL_CAST) {
		// The divex is small enough. A direct cast is safe, and won't become Infinite.
		decimalPartAsNumber = Number(fractionalPartShifted);
	} else {
		// The divex is too large, casting the fractional part would result in Infinity.
		// Truncate the LEAST significant bits of the
		// fractional part before casting to avoid an overflow.
		const shiftAmount = bd.divex - MAX_BITS_FOR_FRACTIONAL_CAST;
		decimalPartAsNumber = Number(fractionalPartShifted >> BigInt(shiftAmount));
		finalExponent += shiftAmount;
	}

	// 5. Scale the resulting number representation of the fractional part back down.
	const decimalResult = decimalPartAsNumber * (2 ** finalExponent);

	// 6. Return the final sum.
	return numberResult + decimalResult;
}

/**
 * Converts a BigDecimal to a string. This returns its EXACT value!
 *
 * Note: Due to the nature of all binary fractions having power-of-2 denominators,
 * this string can make it appear as if they have more decimal digit precision than they actually do.
 * For example, 1/1024 = 0.0009765625, which at first glance *looks* like it has
 * 9 digits of decimal precision, but in all effectiveness it only has 3 digits of precision,
 * because a single increment to 2/1024 now yields 0.001953125, which changed **every single** digit!
 * The effective decimal digits can be calculated using {@link getEffectiveDecimalPlaces}.
 * @param bd The BigDecimal to convert.
 * @returns The string with the exact value.
 */
function toString(bd: BigDecimal): string {
	if (bd.bigint === ZERO) return '0';
	if (bd.divex === 0) return bd.bigint.toString();

	const isNegative = bd.bigint < ZERO;
	// Use the absolute value for all calculations and add the sign back at the end.
	const absBigInt = isNegative ? -bd.bigint : bd.bigint;
	const divexBigInt = BigInt(bd.divex);

	// 1. Separate the integer and fractional parts.
	const integerPart = absBigInt >> divexBigInt;
	const fractionalPart = absBigInt - (integerPart << divexBigInt);

	// If there's no fraction, we are done. This is a crucial optimization.
	if (fractionalPart === ZERO) return (isNegative ? '-' : '') + integerPart.toString();

	// 2. Convert the fractional part to a decimal string using the 5**N shortcut.
	// The math is: (fractional / 2^d) * 10^d = fractional * 5^d
	const powerOfFive = FIVE ** divexBigInt;
	const decimalDigits = fractionalPart * powerOfFive;
	
	// 3. Pad the decimal string with leading zeros to match the divex.
	let decimalString = decimalDigits.toString().padStart(bd.divex, '0');
	
	// And trim any trailing zeros.
	let i = decimalString.length - 1;
	while (i >= 0 && decimalString[i] === '0') {
		i--;
	}
	decimalString = decimalString.slice(0, i + 1);

	// 4. Combine the parts and the sign into the final string.
	const sign = isNegative ? '-' : '';
	const integerString = integerPart.toString();
	
	// This check is for robustness in case the entire fraction was zeros.
	if (decimalString.length === 0)  return sign + integerString;
	else return sign + integerString + '.' + decimalString;
}

/**
 * Returns the BigDecimal's `bigint` property in binary form, **exactly** like how computers store them,
 * in two's complement notation. Negative values have all their bits flipped, and then added 1.
 * To multiply by -1, reverse all the bits, and add 1. This works both ways.
 * 
 * For readability, if the number is negative, a space will be added after the leading '1' sign.
 * @param bd - The BigDecimal
 * @returns The binary string. If it is negative, the leading `1` sign will have a space after it for readability.
 */
function toDebugBinaryString(bd: BigDecimal): string {
	return bigintmath.toDebugBinaryString(bd.bigint);
}

/**
 * Prints useful information about the BigDecimal, such as its properties,
 * binary string, exact value as a string, and converted back to a number.
 * @param bd - The BigDecimal
 */
function printInfo(bd: BigDecimal): void {
	console.log(bd)
	console.log(`Binary string: ${toDebugBinaryString(bd)}`);
	// console.log(`Bit length: ${MathBigDec.getBitLength(bd)}`)
	console.log(`Converted to String: ${toString(bd)}`); // This is also its EXACT value.
	console.log(`Converted to Number: ${toNumber(bd)}`);
	console.log('----------------------------')
}

/**
 * Estimates the number of effective decimal place precision of a BigDecimal.
 * This is a little less than one-third of the divex, or the decimal bit-count precision.
 * @param bd - The BigDecimal
 * @returns The number of estimated effective decimal places.
 */
function getEffectiveDecimalPlaces(bd: BigDecimal): number {
	if (bd.divex <= MAX_DIVEX_BEFORE_INFINITY) {
		const powerOfTwo: number = powersOfTwoList[bd.divex];
		const precision: number = Math.log10(powerOfTwo);
		return Math.floor(precision);
	} else {
		const powerOfTwo: bigint = getBigintPowerOfTwo(bd.divex)
		return bigintmath.log10(powerOfTwo);
	}
}


// HOLD OFF ON THESE FOR NOW, I'M NOT SURE IF WE WILL NEED THEM...

// /**
//  * TO BE WRITTEN...
//  * 
//  * Detects if the provided BigDecimals are equal.
//  * To do this, it first tries to convert them into the same divex level,
//  * because BigDecimals of different divex levels may still be equal,
//  * so it's not enough to compare their `bigint` properties.
//  * @param bd1 - BigDecimal1
//  * @param bd2 - BigDecimal2
//  * @returns *true* if they are equal
//  */
// areEqual(bd1: BigDecimal, bd2: BigDecimal): void {

// },

// isGreaterThan(bd1: BigDecimal, bd2: BigDecimal): void {

// },

// isGreaterThanOrEqualTo(bd1: BigDecimal, bd2: BigDecimal): void {

// },

// isLessThan(bd1: BigDecimal, bd2: BigDecimal): void {

// },

// isLessThanOrEqualTo(bd1: BigDecimal, bd2: BigDecimal): void {

// },

// isInteger(bd: BigDecimal): void {

// },


// Exports ====================================================================


export default {
	NewBigDecimal_FromString,
	NewBigDecimal_FromNumber,
	NewBigDecimal_FromBigInt,
	// Helpers
	howManyBitsForDigitsOfPrecision,
	getEffectiveDecimalPlaces,
	// Math and Arithmetic
	add,
	subtract,
	multiply,
	divide,
	abs,
	clone,
	setExponent,
	compare,
	// Conversions and Utility
	toBigInt,
	toNumber,
	toString,
	toDebugBinaryString,
	printInfo,
};



/////////////////////////////////////////////////////////////////////////////////////
// Testing
/////////////////////////////////////////////////////////////////////////////////////



const n1: string = '1.11223344';
const bd1: BigDecimal = NewBigDecimal_FromString(n1);
console.log(`${n1} converted into a BigDecimal:`)
printInfo(bd1)


// (function speedTest_Miscellanious() {

//     const repeat = 10**6;
//     let product;
    
//     console.time('No round');
//     for (let i = 0; i < repeat; i++) {
//         product = MathBigDec.multiply(bd1, bd2, 9);
//     }
//     console.timeEnd('No round');
//     MathBigDec.printInfo(product);
    
//     console.time('Round');
//     for (let i = 0; i < repeat; i++) {
//         product = MathBigDec.multiply(bd1, bd2, 7);
//     }
//     console.timeEnd('Round');
//     MathBigDec.printInfo(product);
// })();





// For testing with other libraries. You may need to install the types:
// npm install --save-dev @types/decimal.js @types/bignumber.js
// import Decimal from 'decimal.js';
// import BigNumber from 'bignumber.js';

// (function speedTest_Multiply() {

//     const factor1: number = 17.111222333444;
//     const factor2: number = 5.55;

//     const bitsOfPrecision: number = 50
//     const f1: BigDecimal = new BigDecimal(factor1, bitsOfPrecision);
//     const f2: BigDecimal = new BigDecimal(factor2, bitsOfPrecision);

//     console.log(`\nMultiplying factors ${factor1} and ${factor2} together...`)
//     console.log(`Expected results: ${factor1 * factor2}\n`)
    
//     const loopCount: number = 10**6;
//     let product: any;
    
//     // This BigDecimal library
//     console.time('BigDecimal')
//     for (let i = 0; i < loopCount; i++) {
//         product = MathBigDec.multiply(f1, f2);
//     }
//     console.timeEnd('BigDecimal')
//     console.log(`BigDecimal product: ${MathBigDec.toString(product)}`)
//     console.log(`Bits of precision used: ${product.divex}`)
//     console.log(`Approximate digits of precision used: ${getEffectiveDecimalPlaces(product)}`)
//     console.log('')
    
    
//     // Decimal libarary
//     const d1: Decimal = new Decimal(factor1);
//     const d2: Decimal = new Decimal(factor2);
//     console.time('Decimal')
//     for (let i = 0; i < loopCount; i++) {
//         product = d1.times(d2);
//     }
//     console.timeEnd('Decimal')
//     console.log(`Decimal product: ${product.toString()}`)
//     console.log(`Decimal digits of precision used: ${product.precision()}`)
//     console.log('')
    
    
//     // BigNumber library
//     const b1: BigNumber = new BigNumber(factor1);
//     const b2: BigNumber = new BigNumber(factor2);
//     console.time('BigNumber')
//     for (let i = 0; i < loopCount; i++) {
//         product = b1.times(b2);
//     }
//     console.timeEnd('BigNumber')
//     console.log(`BigNumber product: ${product.toString()}`)
//     console.log(`BigNumber digits of precision used: ${product.precision()}`)
// })();
