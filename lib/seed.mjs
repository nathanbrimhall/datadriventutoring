export function seedQuestions() {
  const questions = [];
  const add = (prompt, answer, topics, courses, difficulty, explanation, steps = [], choices = [], alternatives = []) =>
    questions.push({prompt,answer,topics,courses,difficulty,explanation,steps,choices,alternatives,type:choices.length?'multiple-choice':'short-response',tolerance:0,source:'tutor',reviewed:true});
  for (const [a,b] of [[2,3],[1,6],[3,4],[2,7],[4,5],[3,7]]) {
    add('Factor completely: x² + '+(a+b)+'x + '+a*b, '(x + '+a+')(x + '+b+')',
      ['Factoring','Quadratics'], ['Algebra I','SAT','GED','Business Math'], a+b>9?'medium':'easy',
      'Find two numbers that multiply to '+a*b+' and add to '+(a+b)+'. They are '+a+' and '+b+', so the expression is (x + '+a+')(x + '+b+').',
      ['Look at the constant term. List its factor pairs.','Choose the pair whose sum equals the coefficient of x.','Write a binomial for each number, then expand to check.'],
      ['(x + '+a+')(x + '+b+')','(x - '+a+')(x - '+b+')','(x + '+a+')(x - '+b+')','(x - '+a+')(x + '+b+')']);
  }
  for (const [a,b,x] of [[3,5,4],[4,7,5],[5,-3,6],[7,2,8],[8,-5,9],[2,11,3]]) {
    add('Solve for x: '+a+'x '+(b<0?'− '+Math.abs(b):'+ '+b)+' = '+(a*x+b),String(x),
      ['Linear equations'],['Algebra I','SAT','GED'],a>5?'medium':'easy',
      'Subtract '+b+' from both sides, then divide by '+a+'. This gives x = '+x+'.',
      ['Undo the addition or subtraction on both sides.','Divide both sides by the coefficient of x.','Substitute your result into the original equation to check.'],[],['x='+x]);
  }
  for(const [price,percent] of [[80,25],[120,15],[60,20],[250,30]]) {
    add('An item costs $'+price+' before a '+percent+'% discount. What is the sale price in dollars?',String(price*(1-percent/100)),
      ['Percentages','Discounts'],['Business Math','GED','SAT'],'easy',
      'Multiply the original price by '+(100-percent)+'/100. The sale price is $'+price*(1-percent/100)+'.',
      ['Convert the discount to a decimal.','Find the discount amount.','Subtract the discount from the original price.']);
  }
  add('A line passes through (2, 5) and (6, 13). What is its slope?','2',['Slope','Linear functions'],['Algebra I','SAT','GED'],'medium','Slope = (13 − 5) / (6 − 2) = 8 / 4 = 2.',['Find the change in y.','Find the change in x.','Divide the change in y by the change in x.'],['2','1/2','4','8']);
  add('A line has slope −3 and passes through (2, 1). What is its y-intercept?','7',['Slope','Linear functions'],['Algebra I','SAT'],'medium','Use y = mx + b: 1 = −3(2) + b, so b = 7.');
  add('A bag contains 3 red and 5 blue marbles. What is the probability of drawing a red marble? Give a fraction or decimal.','3/8',['Probability'],['GED','SAT'],'easy','There are 3 favorable outcomes out of 8 equally likely outcomes. The probability is 3/8.');
  add('What is the mean of 6, 8, 10, 12, and 14?','10',['Statistics','Mean'],['GED','SAT','Business Math'],'easy','The sum is 50. Divide by the 5 values to get 10.');
  add('What is the median of 4, 7, 9, 15, and 20?','9',['Statistics','Median'],['GED','SAT'],'easy','The values are in order, and 9 is the middle value.');
  add('A right triangle has legs of length 9 and 12. What is the length of the hypotenuse?','15',['Geometry','Pythagorean theorem'],['Geometry','GED','SAT'],'medium','c² = 9² + 12² = 225, so c = 15.',['Square both leg lengths.','Add the squares.','Take the positive square root.']);
  add('Solve: 2/(x − 1) = 3/(x + 2).','7',['Rational equations'],['Algebra II','SAT'],'hard','Exclude x = 1 and x = −2. Cross-multiply: 2x + 4 = 3x − 3, so x = 7.',['Identify values that make a denominator zero.','Cross-multiply.','Solve and check against the excluded values.'],[],['x=7']);
  add('Solve for the positive value of x: x² − 5x − 24 = 0.','8',['Factoring','Quadratics'],['Algebra I','Algebra II','SAT'],'hard','Factor as (x − 8)(x + 3) = 0. The positive solution is 8.',[],[],['x=8']);
  add('A business sells an item for $35. Variable cost is $15 per item and fixed costs are $600. How many items must it sell to break even?','30',['Break-even','Linear equations'],['Business Math','Algebra I'],'hard','Each sale contributes $20 toward fixed costs. Divide $600 by $20 to get 30 items.');
  add('The quadratic x² − kx + 36 has a repeated real root and k is positive. Find k.','12',['Quadratics','Discriminant'],['Algebra II','SAT'],'harder','A repeated root requires k² − 4(1)(36) = 0, so k² = 144. Since k is positive, k = 12.');
  questions.push({prompt:'Explain why x² + 5x + 6 factors as (x + 2)(x + 3). Show how you would check your result.',answer:'The numbers 2 and 3 multiply to 6 and add to 5. Expanding (x + 2)(x + 3) gives x² + 3x + 2x + 6 = x² + 5x + 6.',topics:['Factoring','Mathematical reasoning'],courses:['Algebra I','GED'],difficulty:'medium',type:'written-response',choices:[],alternatives:[],steps:[],explanation:'A complete explanation connects the factor pair to both coefficients and checks by expansion.',tolerance:0,reviewed:true});
  return questions;
}
