'use strict';

// The Free Question of the Day bank (polymathlc.com.sg/question).
//
// One Maths and one Science question are shown each Singapore day, and each one's
// worked answer is shown (and emailed) the next day. Every question here follows
// the Singapore primary syllabus: Maths for P4 to P6 (the levels the centre
// teaches) and Science for P3 to P6, as multiple choice with four options.
//
//   id       stable, never reused: a day that already showed a question keeps it
//            (see pickForDay in daily-question-core.js), so ids must not change.
//   level    'P3' … 'P6'
//   topic    the syllabus topic, shown as a tag
//   q        the question (plain text; line breaks with \n)
//   options  exactly four options, all different
//   answer   the index (0–3) of the correct option
//   steps    the worked answer, one step per line
//   idea     the key idea to remember
//
// tools/daily-question-tests.mjs checks the shape of every question and works out
// every Maths answer again from its own numbers, so a typo in an answer fails CI.
// To add a question, add it at the END of its list with a new id.

const MATH = [
  {
    id: 'm001', level: 'P4', topic: 'Whole numbers',
    q: 'What is the value of the digit 7 in 3 762 015?',
    options: ['7 000', '70 000', '700 000', '7 000 000'], answer: 2,
    steps: [
      'Read the places from the right: ones, tens, hundreds, thousands, ten thousands, hundred thousands, millions.',
      '3 762 015 = 3 millions, 7 hundred thousands, 6 ten thousands, 2 thousands, 0 hundreds, 1 ten and 5 ones.',
      'The 7 is in the hundred thousands place, so its value is 7 × 100 000 = 700 000.'
    ],
    idea: 'The value of a digit = the digit × the value of its place.'
  },
  {
    id: 'm002', level: 'P4', topic: 'Factors and multiples',
    q: 'What is the greatest common factor of 24 and 36?',
    options: ['4', '6', '12', '18'], answer: 2,
    steps: [
      'Factors of 24: 1, 2, 3, 4, 6, 8, 12, 24.',
      'Factors of 36: 1, 2, 3, 4, 6, 9, 12, 18, 36.',
      'Common factors: 1, 2, 3, 4, 6, 12. The greatest is 12.',
      '18 is a factor of 36 but not of 24, so it is not a common factor.'
    ],
    idea: 'List the factors in pairs so you never miss one, then pick the largest that appears in both lists.'
  },
  {
    id: 'm003', level: 'P4', topic: 'Fractions',
    q: '3/4 of a number is 27. What is 2/3 of the number?',
    options: ['18', '24', '27', '36'], answer: 1,
    steps: [
      '3 quarters = 27, so 1 quarter = 27 ÷ 3 = 9.',
      'The whole number = 4 quarters = 4 × 9 = 36.',
      '2/3 of 36 = 36 ÷ 3 × 2 = 24.'
    ],
    idea: 'Find 1 part first (unitary method), then the whole, then the fraction you need.'
  },
  {
    id: 'm004', level: 'P4', topic: 'Decimals',
    q: 'Round 7.396 to 2 decimal places.',
    options: ['7.30', '7.39', '7.40', '7.50'], answer: 2,
    steps: [
      '2 decimal places means we keep the hundredths digit: 7.39|6.',
      'The next digit is 6, which is 5 or more, so we round the hundredths up.',
      '7.39 + 0.01 = 7.40. We write the 0 to show the answer is correct to 2 decimal places.'
    ],
    idea: 'Look only at the digit just after the place you are rounding to: 5 or more rounds up.'
  },
  {
    id: 'm005', level: 'P4', topic: 'Whole numbers: word problems',
    q: 'A box holds 24 pencils. Mr Tan buys 15 boxes and gives away 98 pencils. How many pencils does he have left?',
    options: ['252', '262', '272', '358'], answer: 1,
    steps: [
      'Pencils bought: 15 × 24 = 360.',
      'Pencils left: 360 − 98 = 262.'
    ],
    idea: 'Find the total first, then take away.'
  },
  {
    id: 'm006', level: 'P4', topic: 'Area and perimeter',
    q: 'A rectangle has a perimeter of 46 cm. Its length is 15 cm. What is its area?',
    options: ['69 cm²', '105 cm²', '120 cm²', '345 cm²'], answer: 2,
    steps: [
      'Length + breadth = half the perimeter = 46 ÷ 2 = 23 cm.',
      'Breadth = 23 − 15 = 8 cm.',
      'Area = length × breadth = 15 × 8 = 120 cm².'
    ],
    idea: 'Half the perimeter of a rectangle is one length plus one breadth.'
  },
  {
    id: 'm007', level: 'P4', topic: 'Eight-point compass',
    q: 'Ali is facing north. He turns 135° clockwise. Which direction is he facing now?',
    options: ['East', 'South-east', 'South', 'South-west'], answer: 1,
    steps: [
      'On an 8-point compass, each step between points is 45°.',
      '135° ÷ 45° = 3 steps clockwise.',
      'From north: north-east (1), east (2), south-east (3).'
    ],
    idea: 'Count 45° steps around the compass: N, NE, E, SE, S, SW, W, NW.'
  },
  {
    id: 'm008', level: 'P4', topic: 'Fractions',
    q: 'Which of these fractions is the largest?\n3/5, 2/3, 5/8, 7/12',
    options: ['3/5', '2/3', '5/8', '7/12'], answer: 1,
    steps: [
      'Change all four to the same denominator. 120 is a common multiple of 5, 3, 8 and 12.',
      '3/5 = 72/120, 2/3 = 80/120, 5/8 = 75/120, 7/12 = 70/120.',
      'The largest numerator is 80, so 2/3 is the largest.'
    ],
    idea: 'To compare fractions, make the denominators the same (or the numerators the same).'
  },
  {
    id: 'm009', level: 'P4', topic: 'Mixed numbers',
    q: '2 1/4 + 1 5/8 = ?',
    options: ['3 6/12', '3 3/4', '3 7/8', '4 1/8'], answer: 2,
    steps: [
      'Add the wholes: 2 + 1 = 3.',
      'Add the fractions: 1/4 + 5/8 = 2/8 + 5/8 = 7/8.',
      '3 + 7/8 = 3 7/8.'
    ],
    idea: 'Never add the denominators. Make them the same first, then add the numerators.'
  },
  {
    id: 'm010', level: 'P4', topic: 'Division with remainder',
    q: 'When a number is divided by 7, the quotient is 13 and the remainder is 5. What is the number?',
    options: ['91', '96', '98', '101'], answer: 1,
    steps: [
      'Number = divisor × quotient + remainder.',
      '7 × 13 = 91.',
      '91 + 5 = 96. Check: 96 ÷ 7 = 13 remainder 5.'
    ],
    idea: 'Dividend = divisor × quotient + remainder. The remainder is always smaller than the divisor.'
  },
  {
    id: 'm011', level: 'P4', topic: 'Money and decimals',
    q: 'Mei bought 3 files at $2.45 each. She paid with a $10 note. How much change did she get?',
    options: ['$2.55', '$2.65', '$3.65', '$7.35'], answer: 1,
    steps: [
      'Cost of 3 files: 3 × $2.45 = $7.35.',
      'Change: $10.00 − $7.35 = $2.65.'
    ],
    idea: '$7.35 is what she spent, not her change. Read what the question asks for.'
  },
  {
    id: 'm012', level: 'P5', topic: 'Ratio',
    q: 'The ratio of boys to girls in a hall is 3 : 5. There are 24 more girls than boys. How many pupils are there altogether?',
    options: ['64', '72', '96', '120'], answer: 2,
    steps: [
      'Boys = 3 units, girls = 5 units. The difference is 5 − 3 = 2 units.',
      '2 units = 24, so 1 unit = 12.',
      'Total = 3 + 5 = 8 units = 8 × 12 = 96.'
    ],
    idea: 'Match the difference in units to the difference in the question to find 1 unit.'
  },
  {
    id: 'm013', level: 'P5', topic: 'Percentage',
    q: 'A bag costs $80. During a sale, it is sold at a 15% discount. What is the sale price?',
    options: ['$12', '$65', '$68', '$72'], answer: 2,
    steps: [
      'Discount = 15% of $80 = 15/100 × 80 = $12.',
      'Sale price = $80 − $12 = $68.',
      'Or: the sale price is 85% of $80 = $68.'
    ],
    idea: '$12 is the discount. The sale price is what is left after the discount.'
  },
  {
    id: 'm014', level: 'P5', topic: 'Average',
    q: 'The average of 4 numbers is 18. When a fifth number is added, the average becomes 20. What is the fifth number?',
    options: ['20', '22', '28', '38'], answer: 2,
    steps: [
      'Total of the 4 numbers = 4 × 18 = 72.',
      'Total of the 5 numbers = 5 × 20 = 100.',
      'Fifth number = 100 − 72 = 28.'
    ],
    idea: 'Work with totals: total = average × number of items.'
  },
  {
    id: 'm015', level: 'P5', topic: 'Area of triangle',
    q: 'A triangle has a base of 12 cm and a height of 9 cm. What is its area?',
    options: ['21 cm²', '27 cm²', '54 cm²', '108 cm²'], answer: 2,
    steps: [
      'Area of triangle = 1/2 × base × height.',
      '1/2 × 12 × 9 = 54 cm².'
    ],
    idea: 'A triangle is half of a rectangle with the same base and height.'
  },
  {
    id: 'm016', level: 'P5', topic: 'Volume',
    q: 'A rectangular tank measures 40 cm by 25 cm by 30 cm. It is half-filled with water. How many litres of water are in the tank?',
    options: ['1.5 ℓ', '15 ℓ', '30 ℓ', '150 ℓ'], answer: 1,
    steps: [
      'Volume of the tank = 40 × 25 × 30 = 30 000 cm³.',
      'Half of it = 15 000 cm³.',
      '1000 cm³ = 1 ℓ, so 15 000 cm³ = 15 ℓ.'
    ],
    idea: '1 litre = 1000 cm³.'
  },
  {
    id: 'm017', level: 'P5', topic: 'Fractions: division',
    q: '3/4 ÷ 6 = ?',
    options: ['1/8', '2/9', '1/2', '4 1/2'], answer: 0,
    steps: [
      'Dividing by 6 is the same as multiplying by 1/6.',
      '3/4 × 1/6 = 3/24 = 1/8.'
    ],
    idea: 'Dividing by a whole number makes the fraction smaller: share 3 quarters into 6 equal parts.'
  },
  {
    id: 'm018', level: 'P5', topic: 'Rate',
    q: 'A tap fills 18 litres of water in 4 minutes. How long will it take to fill 45 litres at the same rate?',
    options: ['8 min', '10 min', '11 min', '12 min'], answer: 1,
    steps: [
      'In 1 minute the tap fills 18 ÷ 4 = 4.5 litres.',
      'Time for 45 litres = 45 ÷ 4.5 = 10 minutes.'
    ],
    idea: 'Find the rate for 1 unit (per minute) first.'
  },
  {
    id: 'm019', level: 'P5', topic: 'Decimals',
    q: '0.36 × 400 = ?',
    options: ['1.44', '14.4', '144', '1440'], answer: 2,
    steps: [
      '0.36 × 100 = 36.',
      '36 × 4 = 144.'
    ],
    idea: 'Multiplying by 100 moves every digit 2 places to the left.'
  },
  {
    id: 'm020', level: 'P5', topic: 'Fractions: word problems',
    q: 'Jane spent 2/5 of her money on a dress and 1/3 of the remainder on a bag. She had $48 left. How much money did she have at first?',
    options: ['$96', '$108', '$120', '$144'], answer: 2,
    steps: [
      'After the dress, the remainder is 3/5 of her money.',
      'The bag cost 1/3 of 3/5 = 1/5 of her money.',
      'Money left = 3/5 − 1/5 = 2/5 of her money = $48.',
      '1/5 = $24, so at first she had 5 × $24 = $120.'
    ],
    idea: '"Of the remainder" means a fraction of what is left, not of the whole.'
  },
  {
    id: 'm021', level: 'P5', topic: 'Percentage',
    q: 'The price of a book went up from $25 to $30. What is the percentage increase?',
    options: ['5%', '16 2/3%', '20%', '25%'], answer: 2,
    steps: [
      'Increase = $30 − $25 = $5.',
      'Percentage increase = increase ÷ ORIGINAL price × 100% = 5/25 × 100% = 20%.'
    ],
    idea: 'Percentage change is always compared with the original amount.'
  },
  {
    id: 'm022', level: 'P5', topic: 'Ratio',
    q: 'The ratio of the money Amy has to the money Bala has is 2 : 3. After Amy receives $30, they have the same amount. How much did Amy have at first?',
    options: ['$30', '$45', '$60', '$90'], answer: 2,
    steps: [
      'Bala\'s money does not change: 3 units.',
      'After receiving $30, Amy also has 3 units. So $30 = 3 units − 2 units = 1 unit.',
      'Amy had 2 units = 2 × $30 = $60 at first.'
    ],
    idea: 'Find the quantity that stays the same and keep its units fixed.'
  },
  {
    id: 'm023', level: 'P5', topic: 'Angles in a triangle',
    q: 'One angle of a triangle is 48°. The other two angles are equal. What is the size of each of the equal angles?',
    options: ['48°', '66°', '84°', '132°'], answer: 1,
    steps: [
      'The angles of a triangle add up to 180°.',
      'The two equal angles add up to 180° − 48° = 132°.',
      'Each one = 132° ÷ 2 = 66°.'
    ],
    idea: 'Angles in a triangle add up to 180°. A triangle with two equal angles is isosceles.'
  },
  {
    id: 'm024', level: 'P5', topic: 'Order of operations',
    q: '36 − 12 ÷ 4 × 3 + 5 = ?',
    options: ['14', '23', '32', '38'], answer: 2,
    steps: [
      'Do × and ÷ first, from left to right: 12 ÷ 4 = 3, then 3 × 3 = 9.',
      'Then + and − from left to right: 36 − 9 = 27, then 27 + 5 = 32.'
    ],
    idea: 'Brackets first, then × and ÷ (left to right), then + and − (left to right).'
  },
  {
    id: 'm025', level: 'P6', topic: 'Algebra',
    q: 'Simplify 5y + 7 − 2y − 3.',
    options: ['3y + 4', '3y + 10', '7y + 4', '7y + 10'], answer: 0,
    steps: [
      'Group the y terms: 5y − 2y = 3y.',
      'Group the numbers: 7 − 3 = 4.',
      'Answer: 3y + 4.'
    ],
    idea: 'Only like terms can be combined: y terms with y terms, numbers with numbers.'
  },
  {
    id: 'm026', level: 'P6', topic: 'Algebra',
    q: 'Find the value of (3p + 8) ÷ 2 when p = 4.',
    options: ['8', '10', '14', '20'], answer: 1,
    steps: [
      '3p = 3 × 4 = 12.',
      '3p + 8 = 12 + 8 = 20.',
      '20 ÷ 2 = 10.'
    ],
    idea: '3p means 3 × p. Work out the bracket first.'
  },
  {
    id: 'm027', level: 'P6', topic: 'Circles',
    q: 'A circle has a diameter of 14 cm. Find its area. (Take π = 22/7)',
    options: ['44 cm²', '88 cm²', '154 cm²', '616 cm²'], answer: 2,
    steps: [
      'Radius = 14 ÷ 2 = 7 cm.',
      'Area = π × r × r = 22/7 × 7 × 7 = 154 cm².'
    ],
    idea: 'Area uses the RADIUS. 616 cm² is what you get if you use the diameter by mistake.'
  },
  {
    id: 'm028', level: 'P6', topic: 'Circles',
    q: 'Find the perimeter of a semicircle with a diameter of 28 cm. (Take π = 22/7)',
    options: ['44 cm', '72 cm', '88 cm', '116 cm'], answer: 1,
    steps: [
      'Curved edge = 1/2 × π × diameter = 1/2 × 22/7 × 28 = 44 cm.',
      'The perimeter also includes the straight edge, the diameter: 28 cm.',
      'Perimeter = 44 + 28 = 72 cm.'
    ],
    idea: 'The perimeter of a semicircle = half the circumference + the diameter.'
  },
  {
    id: 'm029', level: 'P6', topic: 'Speed',
    q: 'A car travels 180 km in 2 h 15 min. What is its average speed?',
    options: ['72 km/h', '80 km/h', '85 km/h', '90 km/h'], answer: 1,
    steps: [
      '2 h 15 min = 2 1/4 h = 2.25 h.',
      'Speed = distance ÷ time = 180 ÷ 2.25 = 80 km/h.'
    ],
    idea: 'Change minutes to hours before dividing: 15 min = 1/4 h, not 0.15 h.'
  },
  {
    id: 'm030', level: 'P6', topic: 'Speed',
    q: 'Ben cycles at 15 km/h for 40 minutes. How far does he travel?',
    options: ['6 km', '10 km', '12.5 km', '600 km'], answer: 1,
    steps: [
      '40 min = 40/60 h = 2/3 h.',
      'Distance = speed × time = 15 × 2/3 = 10 km.'
    ],
    idea: 'The units must match: km/h needs the time in hours.'
  },
  {
    id: 'm031', level: 'P6', topic: 'Ratio: total unchanged',
    q: 'The ratio of Ali\'s stickers to Ben\'s stickers is 4 : 7. After Ali gives 15 stickers to Ben, the ratio becomes 1 : 3. How many stickers do they have altogether?',
    options: ['99', '121', '132', '144'], answer: 2,
    steps: [
      'The total does not change. Before: 4 + 7 = 11 parts. After: 1 + 3 = 4 parts.',
      'Make the totals the same (44): before 16 : 28, after 11 : 33.',
      'Ali goes from 16 to 11 units, so 5 units = 15 stickers and 1 unit = 3.',
      'Total = 44 units = 44 × 3 = 132.'
    ],
    idea: 'When something moves between two people, their total stays the same.'
  },
  {
    id: 'm032', level: 'P6', topic: 'Percentage',
    q: 'After spending 30% of his money, Ken had $210 left. How much money did he have at first?',
    options: ['$273', '$280', '$300', '$630'], answer: 2,
    steps: [
      'Money left = 100% − 30% = 70% of his money.',
      '70% = $210, so 1% = $3.',
      '100% = $300.'
    ],
    idea: 'The amount left is 70%, not 100%. Never take 30% of $210.'
  },
  {
    id: 'm033', level: 'P6', topic: 'Volume of cube',
    q: 'A cube has a volume of 343 cm³. What is the area of one of its faces?',
    options: ['21 cm²', '42 cm²', '49 cm²', '294 cm²'], answer: 2,
    steps: [
      'Volume of cube = side × side × side, and 7 × 7 × 7 = 343, so each side is 7 cm.',
      'Area of one face = 7 × 7 = 49 cm².',
      '294 cm² is the area of all 6 faces.'
    ],
    idea: 'Know your cubes: 1, 8, 27, 64, 125, 216, 343, 512, 729, 1000.'
  },
  {
    id: 'm034', level: 'P6', topic: 'Percentage',
    q: 'There are 40 pupils in a class. 35% of them walk to school. How many pupils do NOT walk to school?',
    options: ['5', '14', '26', '35'], answer: 2,
    steps: [
      'Pupils who do not walk = 100% − 35% = 65%.',
      '65% of 40 = 65/100 × 40 = 26.'
    ],
    idea: 'Read for NOT: 14 is the number who walk.'
  },
  {
    id: 'm035', level: 'P6', topic: 'Average',
    q: 'Amy, Ben and Cal have an average mass of 42 kg. Amy and Ben have an average mass of 39 kg. What is Cal\'s mass?',
    options: ['42 kg', '45 kg', '48 kg', '51 kg'], answer: 2,
    steps: [
      'Total mass of all three = 3 × 42 = 126 kg.',
      'Total mass of Amy and Ben = 2 × 39 = 78 kg.',
      'Cal = 126 − 78 = 48 kg.'
    ],
    idea: 'Turn each average into a total, then subtract.'
  },
  {
    id: 'm036', level: 'P6', topic: 'Solids and nets',
    q: 'How many edges does a triangular prism have?',
    options: ['6', '8', '9', '12'], answer: 2,
    steps: [
      'A triangular prism has two triangle faces, at the front and the back.',
      'Each triangle has 3 edges: 3 + 3 = 6.',
      '3 more edges join the two triangles. Total = 6 + 3 = 9 edges.'
    ],
    idea: 'A triangular prism has 5 faces, 9 edges and 6 vertices.'
  },
  {
    id: 'm037', level: 'P6', topic: 'Algebra',
    q: 'A pen costs $k. A book costs $3 more than the pen. What is the total cost of 2 pens and 1 book?',
    options: ['$(2k + 3)', '$(2k + 6)', '$(3k + 3)', '$(3k + 6)'], answer: 2,
    steps: [
      '2 pens cost 2 × $k = $2k.',
      '1 book costs $(k + 3).',
      'Total = 2k + k + 3 = $(3k + 3).'
    ],
    idea: 'Write each item in terms of k first, then add like terms.'
  },
  {
    id: 'm038', level: 'P6', topic: 'Fractions',
    q: '2/3 of the children at a party are girls. 1/4 of the girls and 1/2 of the boys wear glasses. What fraction of the children wear glasses?',
    options: ['1/6', '1/3', '5/12', '3/4'], answer: 1,
    steps: [
      'Girls who wear glasses: 1/4 of 2/3 = 2/12 = 1/6 of the children.',
      'Boys are 1/3 of the children. Boys who wear glasses: 1/2 of 1/3 = 1/6 of the children.',
      'Total: 1/6 + 1/6 = 1/3.'
    ],
    idea: 'Turn "a fraction of a fraction" into a fraction of the whole before adding.'
  },
  {
    id: 'm039', level: 'P5', topic: 'Number patterns',
    q: 'What is the next number in this pattern?\n2, 5, 11, 23, 47, …',
    options: ['71', '94', '95', '96'], answer: 2,
    steps: [
      'Look at how each number is made from the one before: 2 × 2 + 1 = 5, 5 × 2 + 1 = 11, 11 × 2 + 1 = 23, 23 × 2 + 1 = 47.',
      'Next: 47 × 2 + 1 = 95.',
      'Check with the differences: 3, 6, 12, 24, … double each time, so the next difference is 48 and 47 + 48 = 95.'
    ],
    idea: 'If the differences double, look for a "× 2" rule.'
  },
  {
    id: 'm040', level: 'P4', topic: 'Time',
    q: 'A movie started at 7.45 p.m. and lasted 2 h 35 min. What time did it end?',
    options: ['9.20 p.m.', '10.10 p.m.', '10.20 p.m.', '10.30 p.m.'], answer: 2,
    steps: [
      '7.45 p.m. + 2 h = 9.45 p.m.',
      '9.45 p.m. + 15 min = 10.00 p.m. That uses 15 of the 35 minutes.',
      '10.00 p.m. + 20 min = 10.20 p.m.'
    ],
    idea: 'Count on to the next full hour first; there are 60 minutes in an hour, not 100.'
  },
  {
    id: 'm041', level: 'P5', topic: 'Area of composite figures',
    q: 'A triangle with a base of 10 cm and a height of 6 cm is cut out of a square of side 10 cm. What is the area of the remaining figure?',
    options: ['40 cm²', '60 cm²', '70 cm²', '94 cm²'], answer: 2,
    steps: [
      'Area of the square = 10 × 10 = 100 cm².',
      'Area of the triangle = 1/2 × 10 × 6 = 30 cm².',
      'Remaining area = 100 − 30 = 70 cm².'
    ],
    idea: 'Area of a shape with a hole = big shape − the part removed.'
  },
  {
    id: 'm042', level: 'P6', topic: 'Speed: moving towards each other',
    q: 'Two towns are 270 km apart. A car leaves Town A at 60 km/h and a lorry leaves Town B at 30 km/h at the same time, travelling towards each other. After how long do they meet?',
    options: ['2 h', '3 h', '4.5 h', '9 h'], answer: 1,
    steps: [
      'Moving towards each other, together they cover 60 + 30 = 90 km every hour.',
      'Time to cover 270 km = 270 ÷ 90 = 3 h.'
    ],
    idea: 'Towards each other: add the speeds. Same direction: subtract them.'
  }
];

const SCIENCE = [
  {
    id: 's001', level: 'P3', topic: 'Diversity: living things',
    q: 'Which of the following is true of ALL living things?',
    options: ['They can move from place to place.', 'They need food, water and air to survive.', 'They can make their own food.', 'They lay eggs.'], answer: 1,
    steps: [
      'Plants are living things but cannot move from place to place, so the first option is wrong.',
      'Only plants make their own food, and many animals give birth to their young instead of laying eggs.',
      'All living things need food, water and air, grow, respond and reproduce.'
    ],
    idea: 'Characteristics of living things: need food, water and air; grow; respond to changes; reproduce.'
  },
  {
    id: 's002', level: 'P3', topic: 'Diversity: plants',
    q: 'Which of these is a non-flowering plant?',
    options: ['Hibiscus', 'Fern', 'Rice plant', 'Balsam'], answer: 1,
    steps: [
      'Hibiscus, rice plants and balsam all produce flowers (rice flowers are small and not colourful, but they are still flowers).',
      'A fern never produces flowers. It reproduces by spores, found on the underside of its leaves.'
    ],
    idea: 'Non-flowering plants include ferns and mosses (spores) and conifers (seeds in cones).'
  },
  {
    id: 's003', level: 'P3', topic: 'Diversity: fungi',
    q: 'Which statement about mushrooms is correct?',
    options: ['They make their own food using sunlight.', 'They reproduce by spores.', 'They are green plants.', 'They reproduce by seeds.'], answer: 1,
    steps: [
      'Mushrooms are fungi, not plants. They have no chlorophyll, so they cannot make food.',
      'They feed on dead or decaying matter.',
      'They reproduce by spores, released from the gills under the cap.'
    ],
    idea: 'Fungi cannot make their own food. They reproduce by spores.'
  },
  {
    id: 's004', level: 'P3', topic: 'Diversity: animals',
    q: 'Which of these animals is a mammal?',
    options: ['Penguin', 'Shark', 'Dolphin', 'Turtle'], answer: 2,
    steps: [
      'Mammals have hair or fur, give birth to live young (most of them) and feed their young with milk.',
      'A dolphin breathes with lungs, gives birth to live young and feeds them milk, so it is a mammal.',
      'A penguin is a bird, a shark is a fish and a turtle is a reptile.'
    ],
    idea: 'Group animals by their features, not by where they live. Living in water does not make an animal a fish.'
  },
  {
    id: 's005', level: 'P3', topic: 'Materials',
    q: 'Which property of metal makes it suitable for making a cooking pot?',
    options: ['It is a good conductor of heat.', 'It is flexible.', 'It is transparent.', 'It floats on water.'], answer: 0,
    steps: [
      'A cooking pot must let heat from the stove pass to the food quickly.',
      'Metal is a good conductor of heat, so the food cooks quickly.'
    ],
    idea: 'Link the property to the use: what must the object do?'
  },
  {
    id: 's006', level: 'P3', topic: 'Magnets',
    q: 'Which of these objects will be attracted to a magnet?',
    options: ['An aluminium can', 'A copper wire', 'A steel paper clip', 'A glass marble'], answer: 2,
    steps: [
      'Magnets attract only magnetic materials: iron, steel, nickel and cobalt.',
      'Aluminium and copper are metals, but they are NOT magnetic.',
      'The steel paper clip is attracted.'
    ],
    idea: 'Not all metals are magnetic. Iron, steel, nickel and cobalt are.'
  },
  {
    id: 's007', level: 'P3', topic: 'Magnets',
    q: 'Two bar magnets are placed with their north poles facing each other. What happens?',
    options: ['They attract each other.', 'They repel each other.', 'Nothing happens.', 'Both magnets lose their magnetism.'], answer: 1,
    steps: [
      'Like poles (N and N, or S and S) repel.',
      'Unlike poles (N and S) attract.'
    ],
    idea: 'Repulsion is the only sure test that an object is a magnet.'
  },
  {
    id: 's008', level: 'P3', topic: 'Life cycles',
    q: 'Which of these animals has a 3-stage life cycle?',
    options: ['Butterfly', 'Mosquito', 'Cockroach', 'Beetle'], answer: 2,
    steps: [
      'A cockroach goes from egg to nymph to adult: 3 stages.',
      'Butterflies, mosquitoes and beetles have 4 stages: egg, larva, pupa, adult.'
    ],
    idea: 'A nymph looks like a small adult without wings. There is no pupa stage in a 3-stage life cycle.'
  },
  {
    id: 's009', level: 'P3', topic: 'Life cycles',
    q: 'At which stage of its life cycle does a butterfly feed the most?',
    options: ['Egg', 'Larva (caterpillar)', 'Pupa', 'Adult'], answer: 1,
    steps: [
      'The caterpillar eats leaves almost all the time and grows quickly.',
      'The pupa does not feed at all, and the adult only drinks nectar.'
    ],
    idea: 'The larva stage is the feeding and growing stage.'
  },
  {
    id: 's010', level: 'P4', topic: 'Matter',
    q: 'Which of these has a definite volume but no definite shape?',
    options: ['Ice', 'Water', 'Air', 'A stone'], answer: 1,
    steps: [
      'Solids (ice, stone) have a definite shape and a definite volume.',
      'Liquids (water) have a definite volume but take the shape of their container.',
      'Gases (air) have no definite shape and no definite volume.'
    ],
    idea: 'Liquid: definite volume, no definite shape.'
  },
  {
    id: 's011', level: 'P4', topic: 'Matter',
    q: 'Air is matter because it…',
    options: ['has mass and occupies space.', 'can be seen.', 'has a definite shape.', 'cannot be compressed.'], answer: 0,
    steps: [
      'Matter is anything that has mass and occupies space.',
      'Air cannot be seen and has no definite shape, and it CAN be compressed. But it has mass and takes up space, so it is matter.'
    ],
    idea: 'Matter = has mass + occupies space.'
  },
  {
    id: 's012', level: 'P4', topic: 'Heat',
    q: 'A metal spoon and a wooden spoon are left in a bowl of hot soup. After 2 minutes, the handle of the metal spoon feels hotter. Why?',
    options: ['Metal is a better conductor of heat than wood.', 'Wood is a better conductor of heat than metal.', 'The metal spoon was hotter at the start.', 'Wood gives out cold to the soup.'], answer: 0,
    steps: [
      'Both spoons gain heat from the hot soup.',
      'Metal is a good conductor of heat, so heat travels along it to the handle quickly.',
      'Wood is a poor conductor of heat, so its handle stays cooler.'
    ],
    idea: 'Heat flows from a hotter place to a colder place. "Cold" does not flow.'
  },
  {
    id: 's013', level: 'P4', topic: 'Heat',
    q: 'Some ice cubes are put into a glass of water at 30 °C. What happens?',
    options: ['The water loses heat to the ice.', 'The ice gives coldness to the water.', 'The water gains heat from the ice.', 'No heat moves.'], answer: 0,
    steps: [
      'Heat always flows from the hotter object to the colder one.',
      'The water (30 °C) is hotter than the ice, so the water loses heat to the ice.',
      'The ice gains heat and melts, and the water\'s temperature drops.'
    ],
    idea: 'There is no such thing as "coldness" flowing. Only heat flows, from hot to cold.'
  },
  {
    id: 's014', level: 'P4', topic: 'Light',
    q: 'How are we able to see a book on a table in a lit room?',
    options: ['Light from our eyes reaches the book.', 'Light reflected from the book enters our eyes.', 'The book gives out its own light.', 'Light passes through the book.'], answer: 1,
    steps: [
      'The book is not a light source.',
      'Light from a source (a lamp or the Sun) falls on the book and is reflected.',
      'We see the book when the reflected light enters our eyes.'
    ],
    idea: 'We see an object when light from it (given out or reflected) enters our eyes.'
  },
  {
    id: 's015', level: 'P4', topic: 'Light: shadows',
    q: 'A shadow is formed when…',
    options: ['a transparent object lets light through.', 'an opaque object blocks light.', 'light is reflected by a mirror.', 'light bends as it enters water.'], answer: 1,
    steps: [
      'Light travels in straight lines.',
      'An opaque object does not allow light to pass through, so it blocks the light.',
      'The dark area behind it, where light cannot reach, is the shadow.'
    ],
    idea: 'Shadow = an area where light is blocked by an opaque (or translucent) object.'
  },
  {
    id: 's016', level: 'P4', topic: 'Digestive system',
    q: 'In which part of the digestive system is digestion completed?',
    options: ['Mouth', 'Stomach', 'Small intestine', 'Large intestine'], answer: 2,
    steps: [
      'Digestion starts in the mouth and continues in the stomach.',
      'It is completed in the small intestine, where the digested food is also absorbed into the blood.',
      'The large intestine absorbs water. It does not digest food.'
    ],
    idea: 'Small intestine: digestion is completed and digested food is absorbed.'
  },
  {
    id: 's017', level: 'P4', topic: 'Digestive system',
    q: 'Which part of the digestive system absorbs most of the water from undigested food?',
    options: ['Gullet', 'Stomach', 'Small intestine', 'Large intestine'], answer: 3,
    steps: [
      'After the small intestine, what is left is mostly undigested food and water.',
      'The large intestine absorbs water from it, so the waste becomes solid.'
    ],
    idea: 'Large intestine: absorbs water.'
  },
  {
    id: 's018', level: 'P4', topic: 'Plant parts',
    q: 'What are the main functions of the roots of a plant?',
    options: ['To make food and give out oxygen', 'To take in water and mineral salts and hold the plant firmly in the soil', 'To carry food to the leaves', 'To attract insects for pollination'], answer: 1,
    steps: [
      'Roots take in water and mineral salts from the soil.',
      'They also hold the plant firmly in the ground.',
      'Food is made in the leaves, and flowers attract insects.'
    ],
    idea: 'Roots: absorb water and mineral salts, and anchor the plant.'
  },
  {
    id: 's019', level: 'P4', topic: 'Matter: changes of state',
    q: 'At what temperature does pure water boil at sea level?',
    options: ['0 °C', '37 °C', '100 °C', '212 °C'], answer: 2,
    steps: [
      'Pure water boils at 100 °C and freezes (or melts) at 0 °C.',
      '37 °C is normal human body temperature.'
    ],
    idea: 'Water: melts/freezes at 0 °C, boils at 100 °C. It evaporates at any temperature.'
  },
  {
    id: 's020', level: 'P4', topic: 'Matter',
    q: 'Which statement about gases is true?',
    options: ['They have a definite shape.', 'They have a definite volume.', 'They can be compressed.', 'They have no mass.'], answer: 2,
    steps: [
      'Gases have no definite shape and no definite volume: they fill their whole container.',
      'There is a lot of space between gas particles, so gases can be compressed.',
      'Gases are matter, so they have mass.'
    ],
    idea: 'Gas: no definite shape, no definite volume, can be compressed, has mass.'
  },
  {
    id: 's021', level: 'P5', topic: 'Water cycle',
    q: 'Water droplets form on the outside of a cold can of drink. Which process causes this?',
    options: ['Evaporation', 'Condensation', 'Melting', 'Boiling'], answer: 1,
    steps: [
      'Warmer water vapour in the surrounding air comes into contact with the cooler surface of the can.',
      'The water vapour loses heat to the can and condenses into water droplets.',
      'The water does not come from inside the can.'
    ],
    idea: 'Condensation = water vapour loses heat and changes into water.'
  },
  {
    id: 's022', level: 'P5', topic: 'Water cycle: evaporation',
    q: 'Which of these will make wet clothes dry the fastest?',
    options: ['Hanging them in a windy place', 'Folding them up', 'Hanging them in a shady place with no wind', 'Putting them in a plastic bag'], answer: 0,
    steps: [
      'Wind removes the water vapour around the clothes, so more water can evaporate.',
      'Folding them or putting them in a bag reduces the exposed surface area and traps the water vapour.',
      'Shade means less heat from the Sun.'
    ],
    idea: 'Evaporation is faster with more wind, a higher temperature and a larger exposed surface area.'
  },
  {
    id: 's023', level: 'P5', topic: 'Reproduction in plants',
    q: 'Which part of a flower develops into a fruit after fertilisation?',
    options: ['Anther', 'Stigma', 'Ovary', 'Petal'], answer: 2,
    steps: [
      'After fertilisation, the ovary develops into the fruit.',
      'The ovules inside the ovary develop into seeds.'
    ],
    idea: 'Ovary → fruit. Ovule → seed.'
  },
  {
    id: 's024', level: 'P5', topic: 'Reproduction in plants',
    q: 'What is pollination?',
    options: ['The transfer of pollen grains from the anther to the stigma', 'The fusion of the male and female reproductive cells', 'The scattering of seeds away from the parent plant', 'The growth of a seed into a young plant'], answer: 0,
    steps: [
      'Pollination is the transfer of pollen grains from the anther to the stigma.',
      'The fusion of the male and female reproductive cells comes after pollination: that is fertilisation.',
      'Scattering seeds is dispersal, and a seed growing is germination.'
    ],
    idea: 'Pollination, then fertilisation, then fruit and seed, then dispersal, then germination.'
  },
  {
    id: 's025', level: 'P5', topic: 'Seed dispersal',
    q: 'A fruit is light and has wing-like parts. How is it most likely dispersed?',
    options: ['By water', 'By wind', 'By animals', 'By splitting'], answer: 1,
    steps: [
      'Light fruits with wings, hairs or feathery parts can be carried far by the wind.',
      'Wings let the fruit spin and stay in the air longer.'
    ],
    idea: 'Link the feature to the method: wings or hairs → wind; fibrous husk → water; hooks or juicy flesh → animals.'
  },
  {
    id: 's026', level: 'P5', topic: 'Reproduction in humans',
    q: 'During fertilisation in humans, which cell does a sperm fuse with?',
    options: ['An egg', 'A pollen grain', 'An ovule', 'A blood cell'], answer: 0,
    steps: [
      'The male reproductive cell is the sperm, made in the testes.',
      'The female reproductive cell is the egg, made in the ovaries.',
      'Fertilisation is the fusion of a sperm with an egg. Pollen grains and ovules are parts of flowers.'
    ],
    idea: 'Fertilisation = the fusion of the male and female reproductive cells.'
  },
  {
    id: 's027', level: 'P5', topic: 'Cells',
    q: 'Which part of a cell controls all its activities?',
    options: ['Cell membrane', 'Cytoplasm', 'Nucleus', 'Cell wall'], answer: 2,
    steps: [
      'The nucleus controls all the activities of the cell and contains the genetic material.',
      'The cell membrane controls what goes in and out of the cell, which is not the same thing.'
    ],
    idea: 'Nucleus: controls all cell activities. Cell membrane: controls movement of substances in and out.'
  },
  {
    id: 's028', level: 'P5', topic: 'Cells',
    q: 'Which part is found in plant cells but NOT in animal cells?',
    options: ['Nucleus', 'Cytoplasm', 'Cell wall', 'Cell membrane'], answer: 2,
    steps: [
      'Both plant and animal cells have a nucleus, cytoplasm and a cell membrane.',
      'Only plant cells have a cell wall, which gives them a regular, fixed shape. (Many plant cells also have chloroplasts.)'
    ],
    idea: 'Plant cells only: cell wall and chloroplasts (in the green parts).'
  },
  {
    id: 's029', level: 'P5', topic: 'Respiratory system',
    q: 'In which part of the body does oxygen pass from the air into the blood?',
    options: ['Nose', 'Windpipe', 'Air sacs in the lungs', 'Heart'], answer: 2,
    steps: [
      'Air travels through the nose and windpipe into the lungs.',
      'In the lungs, oxygen passes from the air in the air sacs into the blood.',
      'Carbon dioxide passes the other way, from the blood into the air sacs, to be breathed out.'
    ],
    idea: 'Gaseous exchange happens in the air sacs of the lungs.'
  },
  {
    id: 's030', level: 'P5', topic: 'Circulatory system',
    q: 'Blood leaving the lungs is rich in ________ and goes next to the ________.',
    options: ['oxygen; heart', 'carbon dioxide; heart', 'oxygen; small intestine', 'carbon dioxide; rest of the body'], answer: 0,
    steps: [
      'In the lungs, the blood takes in oxygen and gives out carbon dioxide.',
      'Oxygen-rich blood goes back to the heart first.',
      'The heart then pumps it to the rest of the body.'
    ],
    idea: 'Lungs → heart → body → heart → lungs.'
  },
  {
    id: 's031', level: 'P5', topic: 'Plant transport system',
    q: 'What do the food-carrying tubes in a plant transport?',
    options: ['Water from the roots to the leaves', 'Food from the leaves to the other parts of the plant', 'Air from the leaves to the roots', 'Mineral salts from the leaves to the roots'], answer: 1,
    steps: [
      'Food is made in the leaves.',
      'The food-carrying tubes carry it from the leaves to all the other parts of the plant.',
      'Water and mineral salts travel up from the roots in the water-carrying tubes.'
    ],
    idea: 'Water-carrying tubes: roots → upwards. Food-carrying tubes: leaves → all parts.'
  },
  {
    id: 's032', level: 'P5', topic: 'Electrical systems',
    q: 'Which object, used to close a gap in a working circuit, will make the bulb light up?',
    options: ['A rubber band', 'A plastic straw', 'An iron nail', 'A wooden stick'], answer: 2,
    steps: [
      'The bulb lights up only if the circuit is closed with an electrical conductor.',
      'Iron is a metal and a good conductor of electricity.',
      'Rubber, plastic and wood are electrical insulators.'
    ],
    idea: 'Metals conduct electricity. Rubber, plastic, wood and glass are insulators.'
  },
  {
    id: 's033', level: 'P5', topic: 'Electrical systems',
    q: 'Two identical bulbs are connected in series to a battery. If one of the bulbs fuses, what happens to the other bulb?',
    options: ['It becomes brighter.', 'It stays the same.', 'It becomes dimmer but stays lit.', 'It goes out.'], answer: 3,
    steps: [
      'In a series circuit there is only one path for the current.',
      'A fused bulb breaks that path, so the circuit is open.',
      'No current flows, so the other bulb goes out.'
    ],
    idea: 'Series: one path, so one break stops everything. Parallel: each bulb has its own path.'
  },
  {
    id: 's034', level: 'P6', topic: 'Energy conversion',
    q: 'What energy conversion takes place in a solar cell?',
    options: ['Electrical energy → light energy', 'Light energy → electrical energy', 'Heat energy → kinetic energy', 'Chemical potential energy → light energy'], answer: 1,
    steps: [
      'A solar cell takes in light energy from the Sun.',
      'It converts the light energy into electrical energy.'
    ],
    idea: 'Name the energy going in, then the useful energy coming out.'
  },
  {
    id: 's035', level: 'P6', topic: 'Forces: friction',
    q: 'Why is it easier to push a box across a smooth floor than across a rough carpet?',
    options: ['There is less gravitational force on the smooth floor.', 'There is less friction between the box and the smooth floor.', 'The box has less mass on the smooth floor.', 'The smooth floor pushes the box forward.'], answer: 1,
    steps: [
      'Friction acts between two surfaces in contact and opposes motion.',
      'A smoother surface produces less friction.',
      'The gravitational force on the box and its mass are the same in both places.'
    ],
    idea: 'Rougher surfaces → more friction. Friction opposes motion.'
  },
  {
    id: 's036', level: 'P6', topic: 'Forces: gravity',
    q: 'A ball is thrown upwards. Which force makes it fall back down?',
    options: ['Friction', 'Magnetic force', 'Gravitational force', 'Elastic spring force'], answer: 2,
    steps: [
      'The Earth pulls every object towards its centre. This pull is the gravitational force.',
      'It slows the ball down as it rises and then pulls it back to the ground.'
    ],
    idea: 'Gravitational force acts even without contact, always towards the Earth\'s centre.'
  },
  {
    id: 's037', level: 'P6', topic: 'Food chains',
    q: 'In the food chain grass → grasshopper → frog → snake, which organism is the producer?',
    options: ['Grass', 'Grasshopper', 'Frog', 'Snake'], answer: 0,
    steps: [
      'A producer makes its own food by photosynthesis.',
      'Grass is a plant, so it is the producer. The animals are consumers.'
    ],
    idea: 'Food chains start with a producer (a plant). The arrow means "is eaten by".'
  },
  {
    id: 's038', level: 'P6', topic: 'Food chains',
    q: 'In the food chain grass → grasshopper → frog → snake, all the frogs are removed. What will most likely happen to the number of grasshoppers at first?',
    options: ['It will increase.', 'It will decrease.', 'It will stay the same.', 'It will drop to zero.'], answer: 0,
    steps: [
      'Frogs eat grasshoppers.',
      'With no frogs, fewer grasshoppers are eaten, so the number of grasshoppers increases at first.',
      'Later it may fall again, when there is not enough grass for so many grasshoppers.'
    ],
    idea: 'Remove a predator → its prey increases at first.'
  },
  {
    id: 's039', level: 'P6', topic: 'Adaptations',
    q: 'A cactus has spines instead of broad leaves. How does this help it survive in the desert?',
    options: ['It reduces water loss.', 'It makes more food.', 'It absorbs water through the spines.', 'It attracts insects for pollination.'], answer: 0,
    steps: [
      'Plants lose water through their leaves.',
      'Spines have a much smaller surface area than broad leaves, so less water is lost.',
      'This matters in the desert, where water is scarce. (The spines also protect it from animals.)'
    ],
    idea: 'Explain an adaptation as: feature → how it helps → survival in that environment.'
  },
  {
    id: 's040', level: 'P6', topic: 'Man\'s impact on the environment',
    q: 'Cutting down large areas of forest can increase the amount of carbon dioxide in the air. Why?',
    options: ['Fewer plants are left to take in carbon dioxide for photosynthesis.', 'Cut trees give out more oxygen.', 'The soil takes in more carbon dioxide.', 'Animals in the forest breathe more slowly.'], answer: 0,
    steps: [
      'Plants take in carbon dioxide from the air to make food during photosynthesis.',
      'With fewer trees, less carbon dioxide is removed from the air.',
      'Burning the cut trees also releases carbon dioxide.'
    ],
    idea: 'Photosynthesis takes in carbon dioxide and gives out oxygen.'
  },
  {
    id: 's041', level: 'P6', topic: 'Photosynthesis',
    q: 'Which of these is NOT needed by a plant to make food?',
    options: ['Light', 'Water', 'Carbon dioxide', 'Oxygen'], answer: 3,
    steps: [
      'Photosynthesis needs light, water, carbon dioxide and chlorophyll.',
      'Oxygen is given out during photosynthesis. It is not needed to make food.'
    ],
    idea: 'Light + water + carbon dioxide (with chlorophyll) → food (sugar) + oxygen.'
  },
  {
    id: 's042', level: 'P6', topic: 'Energy conversion',
    q: 'A ball is released at the top of a slope and rolls down. Which energy conversion takes place?',
    options: ['Kinetic energy → gravitational potential energy', 'Gravitational potential energy → kinetic energy', 'Electrical energy → kinetic energy', 'Light energy → heat energy'], answer: 1,
    steps: [
      'At the top, the ball has gravitational potential energy because of its height.',
      'As it rolls down, it loses height and speeds up.',
      'So gravitational potential energy is converted into kinetic energy (with some heat and sound because of friction).'
    ],
    idea: 'Higher → more gravitational potential energy. Faster → more kinetic energy.'
  }
];

module.exports = { MATH, SCIENCE };
