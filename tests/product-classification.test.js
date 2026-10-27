'use strict';
// Titles as shoppers meet them. The first version of the classifier was checked against short
// synthetic names ("Body wash", "Fluoride toothpaste") and passed; against real listing titles it
// missed 21 products it should claim and claimed 6 it should not (dog shampoo, car-wash shampoo,
// shoe deodorant). Each row is [title, expected], where expected is a category (recognized) or one
// of 'unknown', 'unsupported', 'ambiguous'.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyProduct, allowsProduct } = require('../src/engine/db/ingestible.js');

const label = title => {
  const got = classifyProduct(title);
  return got.status === 'recognized' ? got.category : got.status;
};

const RECOGNIZED = [
  ['Colgate Cavity Protection Fluoride Toothpaste, Great Regular Flavor, 6 oz', 'toothpaste'],
  ['Crest Pro-Health Advanced Gum Protection Toothpaste', 'toothpaste'],
  ['Sensodyne Pronamel Gentle Whitening Enamel Toothpaste for Sensitive Teeth', 'toothpaste'],
  ['Colgate Total SF Tooth Paste, 4.8 oz', 'toothpaste'],
  ['Hello Naturally Whitening Fluoride Toothpaste', 'toothpaste'],
  ['Colgate Kids Tooth Gel, Strawberry', 'toothpaste'],
  ['Listerine Cool Mint Antiseptic Mouthwash, 1 L', 'mouthwash'],
  ['Crest Pro-Health Multi-Protection Mouth Wash, Alcohol Free', 'mouthwash'],
  ['ACT Anticavity Fluoride Rinse, Mint', 'mouthwash'],
  ['TheraBreath Fresh Breath Oral Rinse', 'mouthwash'],
  ['Dove Advanced Care Antiperspirant Deodorant Stick', 'deodorant'],
  ['Native Deodorant Contains Probiotics', 'deodorant'],
  ['Degree Men Dry Protection Anti-Perspirant', 'deodorant'],
  ['Mitchum Women Clinical Soft Solid Antiperspirant', 'deodorant'],
  ['Head & Shoulders Classic Clean Dandruff Shampoo', 'shampoo'],
  ['Pantene Pro-V Daily Moisture Renewal Shampoo', 'shampoo'],
  ['Biotin Shampoo for Hair Growth', 'shampoo'],
  ['Pantene Pro-V Daily Moisture Renewal Hydrating Conditioner', 'conditioner'],
  ['TRESemmé Keratin Smooth Conditioner', 'conditioner'],
  ['Coconut Oil Conditioner', 'conditioner'],
  ['Dove Deep Moisture Nourishing Body Wash', 'body-wash'],
  ['Irish Spring Original Bar Soap, 3.7 oz', 'body-wash'],
  ['Softsoap Liquid Hand Soap Refill', 'body-wash'],
  ['Dr. Bronner\'s Pure-Castile Liquid Soap Peppermint', 'body-wash'],
  ['Dove Beauty Bar Gentle Skin Cleanser', 'body-wash'],
  ['Method Gel Hand Wash, Sweet Water', 'body-wash'],
  ['CeraVe Moisturizing Cream, Body and Face Moisturizer', 'moisturizer'],
  ['CeraVe Daily Moisturizing Lotion for Normal to Dry Skin', 'moisturizer'],
  ['Cetaphil Moisturizing Lotion for Dry to Normal Sensitive Skin', 'moisturizer'],
  ['Aveeno Daily Moisturizing Lotion with Oat', 'moisturizer'],
  ['Eucerin Original Healing Cream', 'moisturizer'],
  ['Vaseline Intensive Care Deep Moisture Body Lotion', 'moisturizer'],
  ['Lubriderm Daily Moisture Lotion', 'moisturizer'],
  ['Neutrogena Hydro Boost Water Gel Face Moisturizer', 'moisturizer'],
  ['Burt\'s Bees Almond & Milk Hand Cream', 'moisturizer'],
  ['Pond\'s Cold Cream Moisturizer', 'moisturizer'],
  ['Pond\'s Moisturizing Cream', 'moisturizer'],
  ['Mane \'n Tail Original Shampoo', 'shampoo'],
  ['Nature Made Vitamin D3 2000 IU Softgels', 'supplement'],
  ['Centrum Adult Multivitamin/Multimineral Supplement Tablets', 'supplement'],
  ['Nature Made Multivitamin For Her Gummies', 'supplement'],
  ['Vitafusion Vitamin C Gummies', 'supplement'],
  ['Nordic Naturals Ultimate Omega, 1280 mg Omega-3 Fish Oil Softgels', 'supplement'],
  ['Garden of Life Probiotics 50 Billion CFU Capsules', 'supplement'],
  ['NOW Supplements, Magnesium Glycinate 200 mg, 180 Tablets', 'supplement'],
  ['Zinc 50mg Lozenges Immune Support', 'supplement'],
  ['Melatonin 5 mg Fast Dissolve Tablets', 'supplement'],
  ['Elderberry Gummies with Vitamin C and Zinc', 'supplement'],
  ['Ashwagandha Root Extract Capsules 1300mg', 'supplement'],
  ['Turmeric Curcumin with BioPerine Capsules', 'supplement'],
  ['Creatine Monohydrate Powder', 'supplement'],
  ['Biotin 10000 mcg Hair Skin Nails', 'supplement'],
  ['Iron 65 mg Tablets', 'supplement'],
];

// Not claimed: food that borrows a vitamin word, things that are not for people, drugs and
// cosmetics that have no rubric. 'unknown' leaves the product to the food gate, as before.
const NOT_CLAIMED = [
  ['Silk Unsweetened Vanilla Almondmilk with Vitamin D', 'unknown'],
  ['Vitamin D Fortified Whole Milk', 'unknown'],
  ['Calcium Fortified Orange Juice', 'unknown'],
  ['Honey Nut Cheerios Cereal', 'unknown'],
  ['Magnum Double Chocolate Ice Cream Bars', 'unknown'],
  ['Land O Lakes Heavy Whipping Cream', 'unknown'],
  ['Vitaminwater Zero Sugar XXX Acai Blueberry', 'unknown'],
  ['Organic Turmeric Powder, Ground Spice', 'unknown'],
  ['Spirulina Powder Superfood', 'unknown'],
  ['Ginger Chews Candy', 'unknown'],
  ['Iron Man Protein Bar', 'unknown'],
  ['Cat\'s Claw Herbal Tea', 'unknown'],
  ['Bob\'s Red Mill Dough Conditioner', 'unknown'],
  ['Downy Ultra Fabric Conditioner', 'unknown'],
  ['Seachem Prime Water Conditioner for Aquariums', 'unknown'],
  ['Burt\'s Bees for Dogs Oatmeal Shampoo with Colloidal Oat Flour', 'unknown'],
  ['Hartz Groomer\'s Best Dog Shampoo', 'unknown'],
  ['Arm & Hammer Dog Dental Care Enzymatic Toothpaste', 'unknown'],
  ['Meguiar\'s Gold Class Car Wash Shampoo', 'unknown'],
  ['Bissell Carpet Cleaning Shampoo Formula', 'unknown'],
  ['Febreze Fabric Refresher Deodorizer', 'unknown'],
  ['Dial Complete Antibacterial Dish Soap', 'unknown'],
  ['Dawn Ultra Dish Soap', 'unknown'],
  ['Arm & Hammer Foot and Shoe Deodorant Spray', 'unknown'],
  ['Hydrocortisone 1% Anti-Itch Cream', 'unknown'],
  ['Desitin Maximum Strength Diaper Rash Cream', 'unknown'],
  ['Lotrimin AF Athlete\'s Foot Antifungal Cream', 'unknown'],
  ['Aveeno Eczema Therapy Moisturizing Cream', 'unknown'],
  ['Gillette Foamy Shaving Cream', 'unknown'],
  ['Philips Sonicare Replacement Brush Head', 'unknown'],
  ['Tums Antacid Chewable Tablets with Calcium', 'unknown'],
  ['Neutrogena Ultra Sheer Sunscreen Lotion SPF 55', 'unsupported'],
  ['Neutrogena Hydrating Moisturizer with SPF 30', 'unsupported'],
  ['Retinol Face Serum', 'unsupported'],
  ['Vitamin C Serum for Face', 'unsupported'],
  ['Batiste Dry Shampoo', 'unsupported'],
  ['Maybelline Fit Me Foundation', 'unsupported'],
  ['Chapstick Classic Lip Balm', 'unsupported'],
  ['Suave Kids 2-in-1 Shampoo and Conditioner', 'ambiguous'],
  ['Pantene 3-in-1 Shampoo Conditioner Body Wash', 'ambiguous'],
  ['Head & Shoulders 2 in 1 Shampoo', 'ambiguous'],
  ['Crest Toothpaste and Mouthwash Bundle', 'ambiguous'],
  ['Crest Whitening Toothpaste Gift Set', 'ambiguous'],
  // An accessory with no category word keeps the plain not-food notice (its category stays 'unknown').
  ['Oral-B Pro 1000 Electric Toothbrush', 'ambiguous'],
];

test('claims the products the feature is for, as they are titled on real listings', () => {
  for (const [title, expected] of RECOGNIZED) assert.equal(label(title), expected, title);
});

test('leaves food, pets, vehicles, medicine and unsupported cosmetics alone', () => {
  for (const [title, expected] of NOT_CLAIMED) assert.equal(label(title), expected, title);
});

test('only a recognized product opens the merchandise filter', () => {
  assert.equal(allowsProduct('Colgate Total SF Tooth Paste'), true);
  assert.equal(allowsProduct('Colgate Total SF Tooth Paste', { personalCareEnabled: false }), false);
  assert.equal(allowsProduct('Dog Shampoo'), false);
  assert.equal(allowsProduct('Sunscreen Lotion SPF 50'), false);
});

test('a Supplement Facts panel makes a supplement of a title that does not say so', () => {
  assert.equal(classifyProduct('Celsius Sparkling Orange', { supplementFacts: true }).category, 'supplement');
  assert.equal(classifyProduct('Celsius Sparkling Orange').status, 'unknown');
  assert.equal(classifyProduct('Shampoo with biotin', { supplementFacts: true }).category, 'shampoo');
});
