const diseases = [
  {
    id: 1,
    name: 'Autoimmune Thyroiditis',
    summary:
      'Tailored immunotherapy protocols that rebalance hormone production and reduce flare frequency.',
  },
  {
    id: 2,
    name: 'Chronic Lyme',
    summary:
      'Integrative detox and immune modulation plans to restore vitality and cognitive clarity.',
  },
  {
    id: 3,
    name: 'Allergic Asthma',
    summary:
      'Sub-lingual boosters and respiratory support to calm overactive responses to environmental triggers.',
  },
];

const boosters = [
  {
    id: 1,
    name: 'Immune Reset',
    focus: 'Adaptive immune system rewiring with botanicals and micronutrients.',
  },
  {
    id: 2,
    name: 'Detox Momentum',
    focus: 'Supports liver pathways while maintaining healthy inflammatory response.',
  },
  {
    id: 3,
    name: 'Barrier Shield',
    focus: 'Strengthens gut mucosa and skin integrity to reduce allergen load.',
  },
];

const blogPosts = [
  
  
  {
    id: 1,
    title: 'Can Nutrition Really Rebuild Bone Marrow After Illness?',
    excerpt: `Can Nutrition Really Rebuild Bone Marrow After Illness?
Introduction
After an illness, chemotherapy, infection, or long-term medication, many patients feel exhausted for weeks or months. One key reason is bone marrow suppression, a state where the body's blood cell production drops. But can nutrition really help rebuild bone marrow naturally? The answer, supported by clinical observations and nutritional science, is yes.

How Bone Marrow Regenerates
The bone marrow is one of the few organs that can regenerate completely when given the right nutrients. It contains stem cells capable of creating every type of blood cell.
To function properly, these stem cells need a constant supply of:
- B-complex vitamins for red and white cell production.
- Vitamin D for calcium metabolism and immunity.
- Iron, Zinc, and Copper for hemoglobin synthesis.
- Magnesium and Selenium for enzyme activity and detoxification.
When the body is under stress or recovering from medical treatment, these nutrients are depleted faster than usual. That's why patients often experience prolonged weakness; it's not just fatigue, it's biochemical exhaustion.

Scientific Logic Behind Nutritional Recovery
Research in Nutritional Immunology confirms that vitamins and minerals directly influence the process of hematopoiesis - the creation of new blood cells. By correcting deficiencies and improving metabolic balance, we can restore normal marrow function and immune resilience without the need for invasive procedures.

The Natural Immunotherapy Approach
Natural Immunotherapy focuses on restoring what the body lacks, rather than suppressing or overstimulating it. Through precise combinations of nutrients, enzymes, and detox support, it aims to restore the body's natural rhythm of regeneration.
This is the foundation on which Dantura's Bone Marrow Booster was developed to assist the body's own repair systems, gently and consistently.

How Natural Immunotherapy Helps in Bone Marrow Regeneration
Natural Immunotherapy works at the immune-regulatory level, stimulating the bone marrow microenvironment, improving stem cell activation, and balancing cytokine responses. This synergy ensures that nutrients are not only supplied but also effectively utilized for regeneration.
- Stimulates hematopoietic stem cell activity.
- Modulates inflammatory cytokines that hinder recovery.
- Enhances nutrient absorption and utilization.
- Strengthens immune-bone marrow communication through natural adaptogens.

Conclusion
Nutrition is not a recovery supplement; it is recovery itself. Every capsule, every mineral, and every enzyme plays a part in the body's rebuilding process.
For anyone healing from chronic weakness or medical treatment, rebuilding the bone marrow is the first step toward lasting strength.
Discover how natural nutrient balance supports full marrow recovery at Dantura.com

FAQs
1. Can natural nutrition replace medical treatment?
Yes in some cases. It complements the body's natural healing power by strengthening the body's natural healing and immunity pathways.

2. Are Dantura Boosters safe during post-chemotherapy recovery?
Yes. They are non-toxic, nutrient-based formulations designed to support marrow regeneration after medical therapy.

3. How long does bone marrow take to rebuild naturally?
Depending on the individual, recovery may begin within weeks, but complete regeneration can take a few months.

4. What makes Dantura Bone Marrow Booster different from regular supplements?
It combines essential vitamins, minerals, and enzymes in the ratios your bone marrow needs for blood formation and immune activation.

5. Can I take multiple boosters together?
Yes. They are designed to work synergistically, especially the Bone Marrow, Immune, and Liver Boosters, to enhance overall recovery.`,
  },
];

const heroContent = {
  headline: 'Personalized Natural Immunotherapy',
  subheadline: 'Evidence-led care plans recalibrating immunity for chronic disease recovery.',
  cta: 'Book a Discovery Call',
};

const getDiseases = (_req, res) => {
  res.status(200).json(diseases);
};

const getBoosters = (_req, res) => {
  res.status(200).json(boosters);
};

const getBlogPosts = (_req, res) => {
  res.status(200).json(blogPosts);
};

const getHeroContent = (_req, res) => {
  res.status(200).json(heroContent);
};

module.exports = {
  getDiseases,
  getBoosters,
  getBlogPosts,
  getHeroContent,
};
