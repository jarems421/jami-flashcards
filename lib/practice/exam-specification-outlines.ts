import type { ExamSpecificationConcept } from "@/lib/practice/exam-specification-concepts";
import type { ExamSpecificationTopic } from "@/lib/practice/exam-specification-topics";

/**
 * Specifications whose subject content is published as numbered headings.
 *
 * AQA's science specifications name their own structure all the way down --
 * 4.1 Cell biology, 4.1.3 Transport in cells, 4.1.3.2 Osmosis -- so their topic
 * and concept catalogues are the headings themselves, written out once here
 * and derived from, rather than two hand-kept lists that can drift apart.
 *
 * The grain follows the maths catalogue. A topic is a numbered section (4.1),
 * the unit a paper and a student both name. A concept is the finest heading
 * beneath each subsection (4.1.3.2), or the subsection itself where it has no
 * headings of its own (4.2.1). Deeper numbering, such as the lettered steps
 * under "Describing motion along a line", is folded into its heading: that is
 * a sentence of the specification, not something a student practises alone.
 *
 * Headings are copied as the board titles them, with the board's markers
 * ("(biology only)", "(HT only)") taken out of the label. Higher-tier-only
 * content is kept as a flag rather than lost.
 */

export type SpecificationOutlineNode = readonly [
  reference: string,
  title: string,
  children?: readonly SpecificationOutlineNode[],
];

export type SpecificationOutline = {
  specificationId: string;
  /** Every id derived from this outline starts with it. */
  idPrefix: string;
  /**
   * A course made of several subjects labels its topics with the subject,
   * because "Atomic structure" is a chemistry section and a physics section.
   */
  groups: readonly { label?: string; sections: readonly SpecificationOutlineNode[] }[];
  /**
   * Ids are derived from titles, and ids are stored on questions. A heading the
   * board retitles keeps its id by naming its old slug here, by reference.
   */
  slugOverrides?: Readonly<Record<string, string>>;
  source: string;
  /**
   * Set by the person who checked the derived lists against the published
   * specification. Topics first: concepts are only ever served beneath a
   * checked topic list.
   */
  checked?: { topics: boolean; concepts: boolean };
};

const MARKERS = /\s*\((?:(?:biology|chemistry|physics) only|HT only|common content with (?:biology|chemistry|physics))\)/gi;

/** A heading as a student reads it: the board's markers removed. */
export function outlineLabel(title: string) {
  return title.replace(MARKERS, "").replace(/\s+/g, " ").trim();
}

function higherTierOnly(title: string) {
  return /\(HT only\)/i.test(title);
}

export function outlineSlug(label: string) {
  return label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\p{Quotation_Mark}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugOf(outline: SpecificationOutline, [reference, title]: SpecificationOutlineNode) {
  return outline.slugOverrides?.[reference] ?? outlineSlug(outlineLabel(title));
}

function sectionsOf(outline: SpecificationOutline) {
  return outline.groups.flatMap((group) =>
    group.sections.map((section) => ({ group, section, id: `${outline.idPrefix}-${slugOf(outline, section)}` }))
  );
}

export function outlineTopics(outline: SpecificationOutline): ExamSpecificationTopic[] {
  return sectionsOf(outline).map(({ group, section, id }) => ({
    id,
    label: group.label ? `${group.label}: ${outlineLabel(section[1])}` : outlineLabel(section[1]),
  }));
}

export function outlineConcepts(outline: SpecificationOutline): ExamSpecificationConcept[] {
  return sectionsOf(outline).flatMap(({ section, id: topicId }) =>
    (section[2] ?? []).flatMap((subsection) => {
      const [, subsectionTitle, headings] = subsection;
      const leaves = headings?.length ? headings : [subsection];
      return leaves.map((leaf) => {
        const [reference, title] = leaf;
        const higher = higherTierOnly(section[1]) || higherTierOnly(subsectionTitle) || higherTierOnly(title);
        return {
          id: `${topicId}-${slugOf(outline, leaf)}`,
          parentTopicId: topicId,
          label: outlineLabel(title),
          reference,
          ...(higher ? { higherTierOnly: true } : {}),
        };
      });
    })
  );
}

const CHECKED_SOURCE =
  "numbered headings read from the specification's subject content pages on aqa.org.uk " +
  "and cross-checked against the published specification PDF on 2026-09-15, then checked " +
  "against the published specification by the Jami owner on 2026-09-16.";

export const AQA_GCSE_BIOLOGY: SpecificationOutline = {
  specificationId: "8461",
  idPrefix: "aqa-8461",
  // The draft topic list used this id before the outline existed.
  slugOverrides: { "4.6": "inheritance-variation-evolution" },
  source: `AQA GCSE Biology (8461) sections 4.1-4.7: ${CHECKED_SOURCE}`,
  checked: { topics: true, concepts: true },
  groups: [{
    sections: [
      ["4.1", "Cell biology", [
        ["4.1.1", "Cell structure", [
          ["4.1.1.1", "Eukaryotes and prokaryotes"],
          ["4.1.1.2", "Animal and plant cells"],
          ["4.1.1.3", "Cell specialisation"],
          ["4.1.1.4", "Cell differentiation"],
          ["4.1.1.5", "Microscopy"],
          ["4.1.1.6", "Culturing microorganisms (biology only)"],
        ]],
        ["4.1.2", "Cell division", [
          ["4.1.2.1", "Chromosomes"],
          ["4.1.2.2", "Mitosis and the cell cycle"],
          ["4.1.2.3", "Stem cells"],
        ]],
        ["4.1.3", "Transport in cells", [
          ["4.1.3.1", "Diffusion"],
          ["4.1.3.2", "Osmosis"],
          ["4.1.3.3", "Active transport"],
        ]],
      ]],
      ["4.2", "Organisation", [
        ["4.2.1", "Principles of organisation"],
        ["4.2.2", "Animal tissues, organs and organ systems", [
          ["4.2.2.1", "The human digestive system"],
          ["4.2.2.2", "The heart and blood vessels"],
          ["4.2.2.3", "Blood"],
          ["4.2.2.4", "Coronary heart disease: a non-communicable disease"],
          ["4.2.2.5", "Health issues"],
          ["4.2.2.6", "The effect of lifestyle on some non-communicable diseases"],
          ["4.2.2.7", "Cancer"],
        ]],
        ["4.2.3", "Plant tissues, organs and systems", [
          ["4.2.3.1", "Plant tissues"],
          ["4.2.3.2", "Plant organ system"],
        ]],
      ]],
      ["4.3", "Infection and response", [
        ["4.3.1", "Communicable diseases", [
          ["4.3.1.1", "Communicable (infectious) diseases"],
          ["4.3.1.2", "Viral diseases"],
          ["4.3.1.3", "Bacterial diseases"],
          ["4.3.1.4", "Fungal diseases"],
          ["4.3.1.5", "Protist diseases"],
          ["4.3.1.6", "Human defence systems"],
          ["4.3.1.7", "Vaccination"],
          ["4.3.1.8", "Antibiotics and painkillers"],
          ["4.3.1.9", "Discovery and development of drugs"],
        ]],
        ["4.3.2", "Monoclonal antibodies (biology only) (HT only)", [
          ["4.3.2.1", "Producing monoclonal antibodies"],
          ["4.3.2.2", "Uses of monoclonal antibodies"],
        ]],
        ["4.3.3", "Plant disease (biology only)", [
          ["4.3.3.1", "Detection and identification of plant diseases"],
          ["4.3.3.2", "Plant defence responses"],
        ]],
      ]],
      ["4.4", "Bioenergetics", [
        ["4.4.1", "Photosynthesis", [
          ["4.4.1.1", "Photosynthetic reaction"],
          ["4.4.1.2", "Rate of photosynthesis"],
          ["4.4.1.3", "Uses of glucose from photosynthesis"],
        ]],
        ["4.4.2", "Respiration", [
          ["4.4.2.1", "Aerobic and anaerobic respiration"],
          ["4.4.2.2", "Response to exercise"],
          ["4.4.2.3", "Metabolism"],
        ]],
      ]],
      ["4.5", "Homeostasis and response", [
        ["4.5.1", "Homeostasis"],
        ["4.5.2", "The human nervous system", [
          ["4.5.2.1", "Structure and function"],
          ["4.5.2.2", "The brain (biology only)"],
          ["4.5.2.3", "The eye (biology only)"],
          ["4.5.2.4", "Control of body temperature (biology only)"],
        ]],
        ["4.5.3", "Hormonal coordination in humans", [
          ["4.5.3.1", "Human endocrine system"],
          ["4.5.3.2", "Control of blood glucose concentration"],
          ["4.5.3.3", "Maintaining water and nitrogen balance in the body (biology only)"],
          ["4.5.3.4", "Hormones in human reproduction"],
          ["4.5.3.5", "Contraception"],
          ["4.5.3.6", "The use of hormones to treat infertility (HT only)"],
          ["4.5.3.7", "Feedback systems (HT only)"],
        ]],
        ["4.5.4", "Plant hormones (biology only)", [
          ["4.5.4.1", "Control and coordination"],
          ["4.5.4.2", "Use of plant hormones (HT only)"],
        ]],
      ]],
      ["4.6", "Inheritance, variation and evolution", [
        ["4.6.1", "Reproduction", [
          ["4.6.1.1", "Sexual and asexual reproduction"],
          ["4.6.1.2", "Meiosis"],
          ["4.6.1.3", "Advantages and disadvantages of sexual and asexual reproduction (biology only)"],
          ["4.6.1.4", "DNA and the genome"],
          ["4.6.1.5", "DNA structure (biology only)"],
          ["4.6.1.6", "Genetic inheritance"],
          ["4.6.1.7", "Inherited disorders"],
          ["4.6.1.8", "Sex determination"],
        ]],
        ["4.6.2", "Variation and evolution", [
          ["4.6.2.1", "Variation"],
          ["4.6.2.2", "Evolution"],
          ["4.6.2.3", "Selective breeding"],
          ["4.6.2.4", "Genetic engineering"],
          ["4.6.2.5", "Cloning (biology only)"],
        ]],
        ["4.6.3", "The development of understanding of genetics and evolution", [
          ["4.6.3.1", "Theory of evolution (biology only)"],
          ["4.6.3.2", "Speciation (biology only)"],
          ["4.6.3.3", "The understanding of genetics (biology only)"],
          ["4.6.3.4", "Evidence for evolution"],
          ["4.6.3.5", "Fossils"],
          ["4.6.3.6", "Extinction"],
          ["4.6.3.7", "Resistant bacteria"],
        ]],
        ["4.6.4", "Classification of living organisms"],
      ]],
      ["4.7", "Ecology", [
        ["4.7.1", "Adaptations, interdependence and competition", [
          ["4.7.1.1", "Communities"],
          ["4.7.1.2", "Abiotic factors"],
          ["4.7.1.3", "Biotic factors"],
          ["4.7.1.4", "Adaptations"],
        ]],
        ["4.7.2", "Organisation of an ecosystem", [
          ["4.7.2.1", "Levels of organisation"],
          ["4.7.2.2", "How materials are cycled"],
          ["4.7.2.3", "Decomposition (biology only)"],
          ["4.7.2.4", "Impact of environmental change (biology only) (HT only)"],
        ]],
        ["4.7.3", "Biodiversity and the effect of human interaction on ecosystems", [
          ["4.7.3.1", "Biodiversity"],
          ["4.7.3.2", "Waste management"],
          ["4.7.3.3", "Land use"],
          ["4.7.3.4", "Deforestation"],
          ["4.7.3.5", "Global warming"],
          ["4.7.3.6", "Maintaining biodiversity"],
        ]],
        ["4.7.4", "Trophic levels in an ecosystem (biology only)", [
          ["4.7.4.1", "Trophic levels"],
          ["4.7.4.2", "Pyramids of biomass"],
          ["4.7.4.3", "Transfer of biomass"],
        ]],
        ["4.7.5", "Food production (biology only)", [
          ["4.7.5.1", "Factors affecting food security"],
          ["4.7.5.2", "Farming techniques"],
          ["4.7.5.3", "Sustainable fisheries"],
          ["4.7.5.4", "Role of biotechnology"],
        ]],
      ]],
    ],
  }],
};

export const AQA_GCSE_CHEMISTRY: SpecificationOutline = {
  specificationId: "8462",
  idPrefix: "aqa-8462",
  source: `AQA GCSE Chemistry (8462) sections 4.1-4.10: ${CHECKED_SOURCE}`,
  checked: { topics: true, concepts: true },
  groups: [{
    sections: [
      ["4.1", "Atomic structure and the periodic table", [
        ["4.1.1", "A simple model of the atom, symbols, relative atomic mass, electronic charge and isotopes", [
          ["4.1.1.1", "Atoms, elements and compounds"],
          ["4.1.1.2", "Mixtures"],
          ["4.1.1.3", "The development of the model of the atom (common content with physics)"],
          ["4.1.1.4", "Relative electrical charges of subatomic particles"],
          ["4.1.1.5", "Size and mass of atoms"],
          ["4.1.1.6", "Relative atomic mass"],
          ["4.1.1.7", "Electronic structure"],
        ]],
        ["4.1.2", "The periodic table", [
          ["4.1.2.1", "The periodic table"],
          ["4.1.2.2", "Development of the periodic table"],
          ["4.1.2.3", "Metals and non-metals"],
          ["4.1.2.4", "Group 0"],
          ["4.1.2.5", "Group 1"],
          ["4.1.2.6", "Group 7"],
        ]],
        ["4.1.3", "Properties of transition metals (chemistry only)", [
          ["4.1.3.1", "Comparison with Group 1 elements"],
          ["4.1.3.2", "Typical properties"],
        ]],
      ]],
      ["4.2", "Bonding, structure, and the properties of matter", [
        ["4.2.1", "Chemical bonds, ionic, covalent and metallic", [
          ["4.2.1.1", "Chemical bonds"],
          ["4.2.1.2", "Ionic bonding"],
          ["4.2.1.3", "Ionic compounds"],
          ["4.2.1.4", "Covalent bonding"],
          ["4.2.1.5", "Metallic bonding"],
        ]],
        ["4.2.2", "How bonding and structure are related to the properties of substances", [
          ["4.2.2.1", "The three states of matter"],
          ["4.2.2.2", "State symbols"],
          ["4.2.2.3", "Properties of ionic compounds"],
          ["4.2.2.4", "Properties of small molecules"],
          ["4.2.2.5", "Polymers"],
          ["4.2.2.6", "Giant covalent structures"],
          ["4.2.2.7", "Properties of metals and alloys"],
          ["4.2.2.8", "Metals as conductors"],
        ]],
        ["4.2.3", "Structure and bonding of carbon", [
          ["4.2.3.1", "Diamond"],
          ["4.2.3.2", "Graphite"],
          ["4.2.3.3", "Graphene and fullerenes"],
        ]],
        ["4.2.4", "Bulk and surface properties of matter including nanoparticles (chemistry only)", [
          ["4.2.4.1", "Sizes of particles and their properties"],
          ["4.2.4.2", "Uses of nanoparticles"],
        ]],
      ]],
      ["4.3", "Quantitative chemistry", [
        ["4.3.1", "Chemical measurements, conservation of mass and the quantitative interpretation of chemical equations", [
          ["4.3.1.1", "Conservation of mass and balanced chemical equations"],
          ["4.3.1.2", "Relative formula mass"],
          ["4.3.1.3", "Mass changes when a reactant or product is a gas"],
          ["4.3.1.4", "Chemical measurements"],
        ]],
        ["4.3.2", "Use of amount of substance in relation to masses of pure substances", [
          ["4.3.2.1", "Moles (HT only)"],
          ["4.3.2.2", "Amounts of substances in equations (HT only)"],
          ["4.3.2.3", "Using moles to balance equations (HT only)"],
          ["4.3.2.4", "Limiting reactants (HT only)"],
          ["4.3.2.5", "Concentration of solutions"],
        ]],
        ["4.3.3", "Yield and atom economy of chemical reactions (chemistry only)", [
          ["4.3.3.1", "Percentage yield"],
          ["4.3.3.2", "Atom economy"],
        ]],
        ["4.3.4", "Using concentrations of solutions in mol/dm³ (chemistry only) (HT only)"],
        ["4.3.5", "Use of amount of substance in relation to volumes of gases (chemistry only) (HT only)"],
      ]],
      ["4.4", "Chemical changes", [
        ["4.4.1", "Reactivity of metals", [
          ["4.4.1.1", "Metal oxides"],
          ["4.4.1.2", "The reactivity series"],
          ["4.4.1.3", "Extraction of metals and reduction"],
          ["4.4.1.4", "Oxidation and reduction in terms of electrons (HT only)"],
        ]],
        ["4.4.2", "Reactions of acids", [
          ["4.4.2.1", "Reactions of acids with metals"],
          ["4.4.2.2", "Neutralisation of acids and salt production"],
          ["4.4.2.3", "Soluble salts"],
          ["4.4.2.4", "The pH scale and neutralisation"],
          ["4.4.2.5", "Titrations (chemistry only)"],
          ["4.4.2.6", "Strong and weak acids (HT only)"],
        ]],
        ["4.4.3", "Electrolysis", [
          ["4.4.3.1", "The process of electrolysis"],
          ["4.4.3.2", "Electrolysis of molten ionic compounds"],
          ["4.4.3.3", "Using electrolysis to extract metals"],
          ["4.4.3.4", "Electrolysis of aqueous solutions"],
          ["4.4.3.5", "Representation of reactions at electrodes as half equations (HT only)"],
        ]],
      ]],
      ["4.5", "Energy changes", [
        ["4.5.1", "Exothermic and endothermic reactions", [
          ["4.5.1.1", "Energy transfer during exothermic and endothermic reactions"],
          ["4.5.1.2", "Reaction profiles"],
          ["4.5.1.3", "The energy change of reactions (HT only)"],
        ]],
        ["4.5.2", "Chemical cells and fuel cells (chemistry only)", [
          ["4.5.2.1", "Cells and batteries"],
          ["4.5.2.2", "Fuel cells"],
        ]],
      ]],
      ["4.6", "The rate and extent of chemical change", [
        ["4.6.1", "Rate of reaction", [
          ["4.6.1.1", "Calculating rates of reactions"],
          ["4.6.1.2", "Factors which affect the rates of chemical reactions"],
          ["4.6.1.3", "Collision theory and activation energy"],
          ["4.6.1.4", "Catalysts"],
        ]],
        ["4.6.2", "Reversible reactions and dynamic equilibrium", [
          ["4.6.2.1", "Reversible reactions"],
          ["4.6.2.2", "Energy changes and reversible reactions"],
          ["4.6.2.3", "Equilibrium"],
          ["4.6.2.4", "The effect of changing conditions on equilibrium (HT only)"],
          ["4.6.2.5", "The effect of changing concentration (HT only)"],
          ["4.6.2.6", "The effect of temperature changes on equilibrium (HT only)"],
          ["4.6.2.7", "The effect of pressure changes on equilibrium (HT only)"],
        ]],
      ]],
      ["4.7", "Organic chemistry", [
        ["4.7.1", "Carbon compounds as fuels and feedstock", [
          ["4.7.1.1", "Crude oil, hydrocarbons and alkanes"],
          ["4.7.1.2", "Fractional distillation and petrochemicals"],
          ["4.7.1.3", "Properties of hydrocarbons"],
          ["4.7.1.4", "Cracking and alkenes"],
        ]],
        ["4.7.2", "Reactions of alkenes and alcohols (chemistry only)", [
          ["4.7.2.1", "Structure and formulae of alkenes"],
          ["4.7.2.2", "Reactions of alkenes"],
          ["4.7.2.3", "Alcohols"],
          ["4.7.2.4", "Carboxylic acids"],
        ]],
        ["4.7.3", "Synthetic and naturally occurring polymers (chemistry only)", [
          ["4.7.3.1", "Addition polymerisation"],
          ["4.7.3.2", "Condensation polymerisation (HT only)"],
          ["4.7.3.3", "Amino acids (HT only)"],
          ["4.7.3.4", "DNA (deoxyribonucleic acid) and other naturally occurring polymers"],
        ]],
      ]],
      ["4.8", "Chemical analysis", [
        ["4.8.1", "Purity, formulations and chromatography", [
          ["4.8.1.1", "Pure substances"],
          ["4.8.1.2", "Formulations"],
          ["4.8.1.3", "Chromatography"],
        ]],
        ["4.8.2", "Identification of common gases", [
          ["4.8.2.1", "Test for hydrogen"],
          ["4.8.2.2", "Test for oxygen"],
          ["4.8.2.3", "Test for carbon dioxide"],
          ["4.8.2.4", "Test for chlorine"],
        ]],
        ["4.8.3", "Identification of ions by chemical and spectroscopic means (chemistry only)", [
          ["4.8.3.1", "Flame tests"],
          ["4.8.3.2", "Metal hydroxides"],
          ["4.8.3.3", "Carbonates"],
          ["4.8.3.4", "Halides"],
          ["4.8.3.5", "Sulfates"],
          ["4.8.3.6", "Instrumental methods"],
          ["4.8.3.7", "Flame emission spectroscopy"],
        ]],
      ]],
      ["4.9", "Chemistry of the atmosphere", [
        ["4.9.1", "The composition and evolution of the Earth's atmosphere", [
          ["4.9.1.1", "The proportions of different gases in the atmosphere"],
          ["4.9.1.2", "The Earth's early atmosphere"],
          ["4.9.1.3", "How oxygen increased"],
          ["4.9.1.4", "How carbon dioxide decreased"],
        ]],
        ["4.9.2", "Carbon dioxide and methane as greenhouse gases", [
          ["4.9.2.1", "Greenhouse gases"],
          ["4.9.2.2", "Human activities which contribute to an increase in greenhouse gases in the atmosphere"],
          ["4.9.2.3", "Global climate change"],
          ["4.9.2.4", "The carbon footprint and its reduction"],
        ]],
        ["4.9.3", "Common atmospheric pollutants and their sources", [
          ["4.9.3.1", "Atmospheric pollutants from fuels"],
          ["4.9.3.2", "Properties and effects of atmospheric pollutants"],
        ]],
      ]],
      ["4.10", "Using resources", [
        ["4.10.1", "Using the Earth's resources and obtaining potable water", [
          ["4.10.1.1", "Using the Earth's resources and sustainable development"],
          ["4.10.1.2", "Potable water"],
          ["4.10.1.3", "Waste water treatment"],
          ["4.10.1.4", "Alternative methods of extracting metals (HT only)"],
        ]],
        ["4.10.2", "Life cycle assessment and recycling", [
          ["4.10.2.1", "Life cycle assessment"],
          ["4.10.2.2", "Ways of reducing the use of resources"],
        ]],
        ["4.10.3", "Using materials (chemistry only)", [
          ["4.10.3.1", "Corrosion and its prevention"],
          ["4.10.3.2", "Alloys as useful materials"],
          ["4.10.3.3", "Ceramics, polymers and composites"],
        ]],
        ["4.10.4", "The Haber process and the use of NPK fertilisers (chemistry only)", [
          ["4.10.4.1", "The Haber process"],
          ["4.10.4.2", "Production and uses of NPK fertilisers"],
        ]],
      ]],
    ],
  }],
};

export const AQA_GCSE_PHYSICS: SpecificationOutline = {
  specificationId: "8463",
  idPrefix: "aqa-8463",
  source: `AQA GCSE Physics (8463) sections 4.1-4.8: ${CHECKED_SOURCE}`,
  checked: { topics: true, concepts: true },
  groups: [{
    sections: [
      ["4.1", "Energy", [
        ["4.1.1", "Energy changes in a system, and the ways energy is stored before and after such changes", [
          ["4.1.1.1", "Energy stores and systems"],
          ["4.1.1.2", "Changes in energy"],
          ["4.1.1.3", "Energy changes in systems"],
          ["4.1.1.4", "Power"],
        ]],
        ["4.1.2", "Conservation and dissipation of energy", [
          ["4.1.2.1", "Energy transfers in a system"],
          ["4.1.2.2", "Efficiency"],
        ]],
        ["4.1.3", "National and global energy resources"],
      ]],
      ["4.2", "Electricity", [
        ["4.2.1", "Current, potential difference and resistance", [
          ["4.2.1.1", "Standard circuit diagram symbols"],
          ["4.2.1.2", "Electrical charge and current"],
          ["4.2.1.3", "Current, resistance and potential difference"],
          ["4.2.1.4", "Resistors"],
        ]],
        ["4.2.2", "Series and parallel circuits"],
        ["4.2.3", "Domestic uses and safety", [
          ["4.2.3.1", "Direct and alternating potential difference"],
          ["4.2.3.2", "Mains electricity"],
        ]],
        ["4.2.4", "Energy transfers", [
          ["4.2.4.1", "Power"],
          ["4.2.4.2", "Energy transfers in everyday appliances"],
          ["4.2.4.3", "The National Grid"],
        ]],
        ["4.2.5", "Static electricity (physics only)", [
          ["4.2.5.1", "Static charge"],
          ["4.2.5.2", "Electric fields"],
        ]],
      ]],
      ["4.3", "Particle model of matter", [
        ["4.3.1", "Changes of state and the particle model", [
          ["4.3.1.1", "Density of materials"],
          ["4.3.1.2", "Changes of state"],
        ]],
        ["4.3.2", "Internal energy and energy transfers", [
          ["4.3.2.1", "Internal energy"],
          ["4.3.2.2", "Temperature changes in a system and specific heat capacity"],
          ["4.3.2.3", "Changes of state and specific latent heat"],
        ]],
        ["4.3.3", "Particle model and pressure", [
          ["4.3.3.1", "Particle motion in gases"],
          ["4.3.3.2", "Pressure in gases (physics only)"],
          ["4.3.3.3", "Increasing the pressure of a gas (physics only) (HT only)"],
        ]],
      ]],
      ["4.4", "Atomic structure", [
        ["4.4.1", "Atoms and isotopes", [
          ["4.4.1.1", "The structure of an atom"],
          ["4.4.1.2", "Mass number, atomic number and isotopes"],
          ["4.4.1.3", "The development of the model of the atom (common content with chemistry)"],
        ]],
        ["4.4.2", "Atoms and nuclear radiation", [
          ["4.4.2.1", "Radioactive decay and nuclear radiation"],
          ["4.4.2.2", "Nuclear equations"],
          ["4.4.2.3", "Half-lives and the random nature of radioactive decay"],
          ["4.4.2.4", "Radioactive contamination"],
        ]],
        ["4.4.3", "Hazards and uses of radioactive emissions and of background radiation (physics only)", [
          ["4.4.3.1", "Background radiation"],
          ["4.4.3.2", "Different half-lives of radioactive isotopes"],
          ["4.4.3.3", "Uses of nuclear radiation"],
        ]],
        ["4.4.4", "Nuclear fission and fusion (physics only)", [
          ["4.4.4.1", "Nuclear fission"],
          ["4.4.4.2", "Nuclear fusion"],
        ]],
      ]],
      ["4.5", "Forces", [
        ["4.5.1", "Forces and their interactions", [
          ["4.5.1.1", "Scalar and vector quantities"],
          ["4.5.1.2", "Contact and non-contact forces"],
          ["4.5.1.3", "Gravity"],
          ["4.5.1.4", "Resultant forces"],
        ]],
        ["4.5.2", "Work done and energy transfer"],
        ["4.5.3", "Forces and elasticity"],
        ["4.5.4", "Moments, levers and gears (physics only)"],
        ["4.5.5", "Pressure and pressure differences in fluids (physics only)", [
          ["4.5.5.1", "Pressure in a fluid"],
          ["4.5.5.2", "Atmospheric pressure"],
        ]],
        ["4.5.6", "Forces and motion", [
          ["4.5.6.1", "Describing motion along a line"],
          ["4.5.6.2", "Forces, accelerations and Newton's Laws of motion"],
          ["4.5.6.3", "Forces and braking"],
        ]],
        ["4.5.7", "Momentum (HT only)", [
          ["4.5.7.1", "Momentum is a property of moving objects"],
          ["4.5.7.2", "Conservation of momentum"],
          ["4.5.7.3", "Changes in momentum (physics only)"],
        ]],
      ]],
      ["4.6", "Waves", [
        ["4.6.1", "Waves in air, fluids and solids", [
          ["4.6.1.1", "Transverse and longitudinal waves"],
          ["4.6.1.2", "Properties of waves"],
          ["4.6.1.3", "Reflection of waves (physics only)"],
          ["4.6.1.4", "Sound waves (physics only) (HT only)"],
          ["4.6.1.5", "Waves for detection and exploration (physics only) (HT only)"],
        ]],
        ["4.6.2", "Electromagnetic waves", [
          ["4.6.2.1", "Types of electromagnetic waves"],
          ["4.6.2.2", "Properties of electromagnetic waves 1"],
          ["4.6.2.3", "Properties of electromagnetic waves 2"],
          ["4.6.2.4", "Uses and applications of electromagnetic waves"],
          ["4.6.2.5", "Lenses (physics only)"],
          ["4.6.2.6", "Visible light (physics only)"],
        ]],
        ["4.6.3", "Black body radiation (physics only)", [
          ["4.6.3.1", "Emission and absorption of infrared radiation"],
          ["4.6.3.2", "Perfect black bodies and radiation"],
        ]],
      ]],
      ["4.7", "Magnetism and electromagnetism", [
        ["4.7.1", "Permanent and induced magnetism, magnetic forces and fields", [
          ["4.7.1.1", "Poles of a magnet"],
          ["4.7.1.2", "Magnetic fields"],
        ]],
        ["4.7.2", "The motor effect", [
          ["4.7.2.1", "Electromagnetism"],
          ["4.7.2.2", "Fleming's left-hand rule (HT only)"],
          ["4.7.2.3", "Electric motors (HT only)"],
          ["4.7.2.4", "Loudspeakers (physics only) (HT only)"],
        ]],
        ["4.7.3", "Induced potential, transformers and the National Grid (physics only) (HT only)", [
          ["4.7.3.1", "Induced potential (HT only)"],
          ["4.7.3.2", "Uses of the generator effect (HT only)"],
          ["4.7.3.3", "Microphones (HT only)"],
          ["4.7.3.4", "Transformers (HT only)"],
        ]],
      ]],
      ["4.8", "Space physics (physics only)", [
        ["4.8.1", "Solar system; stability of orbital motions; satellites (physics only)", [
          ["4.8.1.1", "Our solar system"],
          ["4.8.1.2", "The life cycle of a star"],
          ["4.8.1.3", "Orbital motion, natural and artificial satellites"],
        ]],
        ["4.8.2", "Red-shift (physics only)"],
      ]],
    ],
  }],
};

export const AQA_GCSE_COMBINED_SCIENCE_TRILOGY: SpecificationOutline = {
  specificationId: "8464",
  idPrefix: "aqa-8464",
  source: `AQA GCSE Combined Science: Trilogy (8464) sections 4.1-4.7, 5.1-5.10 and 6.1-6.7: ${CHECKED_SOURCE}`,
  checked: { topics: true, concepts: true },
  groups: [
    {
      label: "Biology",
      sections: [
        ["4.1", "Cell biology", [
          ["4.1.1", "Cell structure", [
            ["4.1.1.1", "Eukaryotes and prokaryotes"],
            ["4.1.1.2", "Animal and plant cells"],
            ["4.1.1.3", "Cell specialisation"],
            ["4.1.1.4", "Cell differentiation"],
            ["4.1.1.5", "Microscopy"],
          ]],
          ["4.1.2", "Cell division", [
            ["4.1.2.1", "Chromosomes"],
            ["4.1.2.2", "Mitosis and the cell cycle"],
            ["4.1.2.3", "Stem cells"],
          ]],
          ["4.1.3", "Transport in cells", [
            ["4.1.3.1", "Diffusion"],
            ["4.1.3.2", "Osmosis"],
            ["4.1.3.3", "Active transport"],
          ]],
        ]],
        ["4.2", "Organisation", [
          ["4.2.1", "Principles of organisation"],
          ["4.2.2", "Animal tissues, organs and organ systems", [
            ["4.2.2.1", "The human digestive system"],
            ["4.2.2.2", "The heart and blood vessels"],
            ["4.2.2.3", "Blood"],
            ["4.2.2.4", "Coronary heart disease: a non-communicable disease"],
            ["4.2.2.5", "Health issues"],
            ["4.2.2.6", "The effect of lifestyle on some non-communicable diseases"],
            ["4.2.2.7", "Cancer"],
          ]],
          ["4.2.3", "Plant tissues, organs and systems", [
            ["4.2.3.1", "Plant tissues"],
            ["4.2.3.2", "Plant organ system"],
          ]],
        ]],
        ["4.3", "Infection and response", [
          ["4.3.1", "Communicable diseases", [
            ["4.3.1.1", "Communicable (infectious) diseases"],
            ["4.3.1.2", "Viral diseases"],
            ["4.3.1.3", "Bacterial diseases"],
            ["4.3.1.4", "Fungal diseases"],
            ["4.3.1.5", "Protist diseases"],
            ["4.3.1.6", "Human defence systems"],
            ["4.3.1.7", "Vaccination"],
            ["4.3.1.8", "Antibiotics and painkillers"],
            ["4.3.1.9", "Discovery and development of drugs"],
          ]],
        ]],
        ["4.4", "Bioenergetics", [
          ["4.4.1", "Photosynthesis", [
            ["4.4.1.1", "Photosynthetic reaction"],
            ["4.4.1.2", "Rate of photosynthesis"],
            ["4.4.1.3", "Uses of glucose from photosynthesis"],
          ]],
          ["4.4.2", "Respiration", [
            ["4.4.2.1", "Aerobic and anaerobic respiration"],
            ["4.4.2.2", "Response to exercise"],
            ["4.4.2.3", "Metabolism"],
          ]],
        ]],
        ["4.5", "Homeostasis and response", [
          ["4.5.1", "Homeostasis"],
          ["4.5.2", "The human nervous system"],
          ["4.5.3", "Hormonal coordination in humans", [
            ["4.5.3.1", "Human endocrine system"],
            ["4.5.3.2", "Control of blood glucose concentration"],
            ["4.5.3.3", "Hormones in human reproduction"],
            ["4.5.3.4", "Contraception"],
            ["4.5.3.5", "The use of hormones to treat infertility (HT only)"],
            ["4.5.3.6", "Feedback systems (HT only)"],
          ]],
        ]],
        ["4.6", "Inheritance, variation and evolution", [
          ["4.6.1", "Reproduction", [
            ["4.6.1.1", "Sexual and asexual reproduction"],
            ["4.6.1.2", "Meiosis"],
            ["4.6.1.3", "DNA and the genome"],
            ["4.6.1.4", "Genetic inheritance"],
            ["4.6.1.5", "Inherited disorders"],
            ["4.6.1.6", "Sex determination"],
          ]],
          ["4.6.2", "Variation and evolution", [
            ["4.6.2.1", "Variation"],
            ["4.6.2.2", "Evolution"],
            ["4.6.2.3", "Selective breeding"],
            ["4.6.2.4", "Genetic engineering"],
          ]],
          ["4.6.3", "The development of understanding of genetics and evolution", [
            ["4.6.3.1", "Evidence for evolution"],
            ["4.6.3.2", "Fossils"],
            ["4.6.3.3", "Extinction"],
            ["4.6.3.4", "Resistant bacteria"],
          ]],
          ["4.6.4", "Classification of living organisms"],
        ]],
        ["4.7", "Ecology", [
          ["4.7.1", "Adaptations, interdependence and competition", [
            ["4.7.1.1", "Communities"],
            ["4.7.1.2", "Abiotic factors"],
            ["4.7.1.3", "Biotic factors"],
            ["4.7.1.4", "Adaptations"],
          ]],
          ["4.7.2", "Organisation of an ecosystem", [
            ["4.7.2.1", "Levels of organisation"],
            ["4.7.2.2", "How materials are cycled"],
          ]],
          ["4.7.3", "Biodiversity and the effect of human interaction on ecosystems", [
            ["4.7.3.1", "Biodiversity"],
            ["4.7.3.2", "Waste management"],
            ["4.7.3.3", "Land use"],
            ["4.7.3.4", "Deforestation"],
            ["4.7.3.5", "Global warming"],
            ["4.7.3.6", "Maintaining biodiversity"],
          ]],
        ]],
      ],
    },
    {
      label: "Chemistry",
      sections: [
        ["5.1", "Atomic structure and the periodic table", [
          ["5.1.1", "A simple model of the atom, symbols, relative atomic mass, electronic charge and isotopes", [
            ["5.1.1.1", "Atoms, elements and compounds"],
            ["5.1.1.2", "Mixtures"],
            ["5.1.1.3", "The development of the model of the atom (common content with physics)"],
            ["5.1.1.4", "Relative electrical charges of subatomic particles"],
            ["5.1.1.5", "Size and mass of atoms"],
            ["5.1.1.6", "Relative atomic mass"],
            ["5.1.1.7", "Electronic structure"],
          ]],
          ["5.1.2", "The periodic table", [
            ["5.1.2.1", "The periodic table"],
            ["5.1.2.2", "Development of the periodic table"],
            ["5.1.2.3", "Metals and non-metals"],
            ["5.1.2.4", "Group 0"],
            ["5.1.2.5", "Group 1"],
            ["5.1.2.6", "Group 7"],
          ]],
        ]],
        ["5.2", "Bonding, structure, and the properties of matter", [
          ["5.2.1", "Chemical bonds, ionic, covalent and metallic", [
            ["5.2.1.1", "Chemical bonds"],
            ["5.2.1.2", "Ionic bonding"],
            ["5.2.1.3", "Ionic compounds"],
            ["5.2.1.4", "Covalent bonding"],
            ["5.2.1.5", "Metallic bonding"],
          ]],
          ["5.2.2", "How bonding and structure are related to the properties of substances", [
            ["5.2.2.1", "The three states of matter"],
            ["5.2.2.2", "State symbols"],
            ["5.2.2.3", "Properties of ionic compounds"],
            ["5.2.2.4", "Properties of small molecules"],
            ["5.2.2.5", "Polymers"],
            ["5.2.2.6", "Giant covalent structures"],
            ["5.2.2.7", "Properties of metals and alloys"],
            ["5.2.2.8", "Metals as conductors"],
          ]],
          ["5.2.3", "Structure and bonding of carbon", [
            ["5.2.3.1", "Diamond"],
            ["5.2.3.2", "Graphite"],
            ["5.2.3.3", "Graphene and fullerenes"],
          ]],
        ]],
        ["5.3", "Quantitative chemistry", [
          ["5.3.1", "Chemical measurements, conservation of mass and the quantitative interpretation of chemical equations", [
            ["5.3.1.1", "Conservation of mass and balanced chemical equations"],
            ["5.3.1.2", "Relative formula mass"],
            ["5.3.1.3", "Mass changes when a reactant or product is a gas"],
            ["5.3.1.4", "Chemical measurements"],
          ]],
          ["5.3.2", "Use of amount of substance in relation to masses of pure substances", [
            ["5.3.2.1", "Moles (HT only)"],
            ["5.3.2.2", "Amounts of substances in equations (HT only)"],
            ["5.3.2.3", "Using moles to balance equations (HT only)"],
            ["5.3.2.4", "Limiting reactants (HT only)"],
            ["5.3.2.5", "Concentration of solutions"],
          ]],
        ]],
        ["5.4", "Chemical changes", [
          ["5.4.1", "Reactivity of metals", [
            ["5.4.1.1", "Metal oxides"],
            ["5.4.1.2", "The reactivity series"],
            ["5.4.1.3", "Extraction of metals and reduction"],
            ["5.4.1.4", "Oxidation and reduction in terms of electrons (HT only)"],
          ]],
          ["5.4.2", "Reactions of acids", [
            ["5.4.2.1", "Reactions of acids with metals"],
            ["5.4.2.2", "Neutralisation of acids and salt production"],
            ["5.4.2.3", "Soluble salts"],
            ["5.4.2.4", "The pH scale and neutralisation"],
            ["5.4.2.5", "Strong and weak acids (HT only)"],
          ]],
          ["5.4.3", "Electrolysis", [
            ["5.4.3.1", "The process of electrolysis"],
            ["5.4.3.2", "Electrolysis of molten ionic compounds"],
            ["5.4.3.3", "Using electrolysis to extract metals"],
            ["5.4.3.4", "Electrolysis of aqueous solutions"],
            ["5.4.3.5", "Representation of reactions at electrodes as half equations (HT only)"],
          ]],
        ]],
        ["5.5", "Energy changes", [
          ["5.5.1", "Exothermic and endothermic reactions", [
            ["5.5.1.1", "Energy transfer during exothermic and endothermic reactions"],
            ["5.5.1.2", "Reaction profiles"],
            ["5.5.1.3", "The energy change of reactions (HT only)"],
          ]],
        ]],
        ["5.6", "The rate and extent of chemical change", [
          ["5.6.1", "Rate of reaction", [
            ["5.6.1.1", "Calculating rates of reactions"],
            ["5.6.1.2", "Factors which affect the rates of chemical reactions"],
            ["5.6.1.3", "Collision theory and activation energy"],
            ["5.6.1.4", "Catalysts"],
          ]],
          ["5.6.2", "Reversible reactions and dynamic equilibrium", [
            ["5.6.2.1", "Reversible reactions"],
            ["5.6.2.2", "Energy changes and reversible reactions"],
            ["5.6.2.3", "Equilibrium"],
            ["5.6.2.4", "The effect of changing conditions on equilibrium (HT only)"],
            ["5.6.2.5", "The effect of changing concentration (HT only)"],
            ["5.6.2.6", "The effect of temperature changes on equilibrium (HT only)"],
            ["5.6.2.7", "The effect of pressure changes on equilibrium (HT only)"],
          ]],
        ]],
        ["5.7", "Organic chemistry", [
          ["5.7.1", "Carbon compounds as fuels and feedstock", [
            ["5.7.1.1", "Crude oil, hydrocarbons and alkanes"],
            ["5.7.1.2", "Fractional distillation and petrochemicals"],
            ["5.7.1.3", "Properties of hydrocarbons"],
            ["5.7.1.4", "Cracking and alkenes"],
          ]],
        ]],
        ["5.8", "Chemical analysis", [
          ["5.8.1", "Purity, formulations and chromatography", [
            ["5.8.1.1", "Pure substances"],
            ["5.8.1.2", "Formulations"],
            ["5.8.1.3", "Chromatography"],
          ]],
          ["5.8.2", "Identification of common gases", [
            ["5.8.2.1", "Test for hydrogen"],
            ["5.8.2.2", "Test for oxygen"],
            ["5.8.2.3", "Test for carbon dioxide"],
            ["5.8.2.4", "Test for chlorine"],
          ]],
        ]],
        ["5.9", "Chemistry of the atmosphere", [
          ["5.9.1", "The composition and evolution of the Earth's atmosphere", [
            ["5.9.1.1", "The proportions of different gases in the atmosphere"],
            ["5.9.1.2", "The Earth's early atmosphere"],
            ["5.9.1.3", "How oxygen increased"],
            ["5.9.1.4", "How carbon dioxide decreased"],
          ]],
          ["5.9.2", "Carbon dioxide and methane as greenhouse gases", [
            ["5.9.2.1", "Greenhouse gases"],
            ["5.9.2.2", "Human activities which contribute to an increase in greenhouse gases in the atmosphere"],
            ["5.9.2.3", "Global climate change"],
            ["5.9.2.4", "The carbon footprint and its reduction"],
          ]],
          ["5.9.3", "Common atmospheric pollutants and their sources", [
            ["5.9.3.1", "Atmospheric pollutants from fuels"],
            ["5.9.3.2", "Properties and effects of atmospheric pollutants"],
          ]],
        ]],
        ["5.10", "Using resources", [
          ["5.10.1", "Using the Earth's resources and obtaining potable water", [
            ["5.10.1.1", "Using the Earth's resources and sustainable development"],
            ["5.10.1.2", "Potable water"],
            ["5.10.1.3", "Waste water treatment"],
            ["5.10.1.4", "Alternative methods of extracting metals (HT only)"],
          ]],
          ["5.10.2", "Life cycle assessment and recycling", [
            ["5.10.2.1", "Life cycle assessment"],
            ["5.10.2.2", "Ways of reducing the use of resources"],
          ]],
        ]],
      ],
    },
    {
      label: "Physics",
      sections: [
        ["6.1", "Energy", [
          ["6.1.1", "Energy changes in a system, and the ways energy is stored before and after such changes", [
            ["6.1.1.1", "Energy stores and systems"],
            ["6.1.1.2", "Changes in energy"],
            ["6.1.1.3", "Energy changes in systems"],
            ["6.1.1.4", "Power"],
          ]],
          ["6.1.2", "Conservation and dissipation of energy", [
            ["6.1.2.1", "Energy transfers in a system"],
            ["6.1.2.2", "Efficiency"],
          ]],
          ["6.1.3", "National and global energy resources"],
        ]],
        ["6.2", "Electricity", [
          ["6.2.1", "Current, potential difference and resistance", [
            ["6.2.1.1", "Standard circuit diagram symbols"],
            ["6.2.1.2", "Electrical charge and current"],
            ["6.2.1.3", "Current, resistance and potential difference"],
            ["6.2.1.4", "Resistors"],
          ]],
          ["6.2.2", "Series and parallel circuits"],
          ["6.2.3", "Domestic uses and safety", [
            ["6.2.3.1", "Direct and alternating potential difference"],
            ["6.2.3.2", "Mains electricity"],
          ]],
          ["6.2.4", "Energy transfers", [
            ["6.2.4.1", "Power"],
            ["6.2.4.2", "Energy transfers in everyday appliances"],
            ["6.2.4.3", "The National Grid"],
          ]],
        ]],
        ["6.3", "Particle model of matter", [
          ["6.3.1", "Changes of state and the particle model", [
            ["6.3.1.1", "Density of materials"],
            ["6.3.1.2", "Changes of state"],
          ]],
          ["6.3.2", "Internal energy and energy transfers", [
            ["6.3.2.1", "Internal energy"],
            ["6.3.2.2", "Temperature changes in a system and specific heat capacity"],
            ["6.3.2.3", "Changes of state and specific latent heat"],
          ]],
          ["6.3.3", "Particle model and pressure", [
            ["6.3.3.1", "Particle motion in gases"],
          ]],
        ]],
        ["6.4", "Atomic structure", [
          ["6.4.1", "Atoms and isotopes", [
            ["6.4.1.1", "The structure of an atom"],
            ["6.4.1.2", "Mass number, atomic number and isotopes"],
            ["6.4.1.3", "The development of the model of the atom (common content with chemistry)"],
          ]],
          ["6.4.2", "Atoms and nuclear radiation", [
            ["6.4.2.1", "Radioactive decay and nuclear radiation"],
            ["6.4.2.2", "Nuclear equations"],
            ["6.4.2.3", "Half-lives and the random nature of radioactive decay"],
            ["6.4.2.4", "Radioactive contamination"],
          ]],
        ]],
        ["6.5", "Forces", [
          ["6.5.1", "Forces and their interactions", [
            ["6.5.1.1", "Scalar and vector quantities"],
            ["6.5.1.2", "Contact and non-contact forces"],
            ["6.5.1.3", "Gravity"],
            ["6.5.1.4", "Resultant forces"],
          ]],
          ["6.5.2", "Work done and energy transfer"],
          ["6.5.3", "Forces and elasticity"],
          ["6.5.4", "Forces and motion", [
            ["6.5.4.1", "Describing motion along a line"],
            ["6.5.4.2", "Forces, accelerations and Newton's Laws of motion"],
            ["6.5.4.3", "Forces and braking"],
          ]],
          ["6.5.5", "Momentum (HT only)", [
            ["6.5.5.1", "Momentum is a property of moving objects"],
            ["6.5.5.2", "Conservation of momentum"],
          ]],
        ]],
        ["6.6", "Waves", [
          ["6.6.1", "Waves in air, fluids and solids", [
            ["6.6.1.1", "Transverse and longitudinal waves"],
            ["6.6.1.2", "Properties of waves"],
          ]],
          ["6.6.2", "Electromagnetic waves", [
            ["6.6.2.1", "Types of electromagnetic waves"],
            ["6.6.2.2", "Properties of electromagnetic waves 1"],
            ["6.6.2.3", "Properties of electromagnetic waves 2"],
            ["6.6.2.4", "Uses and applications of electromagnetic waves"],
          ]],
        ]],
        ["6.7", "Magnetism and electromagnetism", [
          ["6.7.1", "Permanent and induced magnetism, magnetic forces and fields", [
            ["6.7.1.1", "Poles of a magnet"],
            ["6.7.1.2", "Magnetic fields"],
          ]],
          ["6.7.2", "The motor effect", [
            ["6.7.2.1", "Electromagnetism"],
            ["6.7.2.2", "Fleming's left-hand rule (HT only)"],
            ["6.7.2.3", "Electric motors (HT only)"],
          ]],
        ]],
      ],
    },
  ],
};

/**
 * AQA GCSE Geography (8035).
 *
 * The grain is a step finer than the sciences because the specification is
 * shaped differently. 3.1 and 3.2 are the two written papers rather than
 * topics, so a topic here is the named section beneath them -- "The challenge
 * of natural hazards" -- which is what a student calls the thing they are
 * revising.
 *
 * Concepts are the numbered headings the board prints under those sections.
 * Two sections have none to print: 3.2.1 Urban issues and challenges and 3.2.2
 * The changing economic world are published as unnumbered key ideas, so they
 * carry a topic and no concepts. A concept invented to fill that gap would be
 * Jami's structure wearing the board's name.
 */
export const AQA_GCSE_GEOGRAPHY: SpecificationOutline = {
  specificationId: "8035",
  idPrefix: "aqa-8035",
  source:
    "AQA GCSE Geography (8035) sections 3.1-3.3, read from the subject content pages on " +
    "aqa.org.uk on 2026-09-16. Sections 3.2.1 and 3.2.2 publish key ideas rather than " +
    "numbered headings and so carry no concepts. Not yet checked by a person.",
  groups: [{
    sections: [
      ["3.1.1", "The challenge of natural hazards", [
        ["3.1.1.1", "Natural hazards"],
        ["3.1.1.2", "Tectonic hazards"],
        ["3.1.1.3", "Weather hazards"],
        ["3.1.1.4", "Climate change"],
      ]],
      ["3.1.2", "The living world", [
        ["3.1.2.1", "Ecosystems"],
        ["3.1.2.2", "Tropical rainforests"],
        ["3.1.2.3", "Hot deserts"],
        ["3.1.2.4", "Cold environments"],
      ]],
      ["3.1.3", "Physical landscapes in the UK", [
        ["3.1.3.1", "UK physical landscapes"],
        ["3.1.3.2", "Coastal landscapes in the UK"],
        ["3.1.3.3", "River landscapes in the UK"],
        ["3.1.3.4", "Glacial landscapes in the UK"],
      ]],
      ["3.2.1", "Urban issues and challenges"],
      ["3.2.2", "The changing economic world"],
      ["3.2.3", "The challenge of resource management", [
        ["3.2.3.1", "Resource management"],
        ["3.2.3.2", "Food"],
        ["3.2.3.3", "Water"],
        ["3.2.3.4", "Energy"],
      ]],
      ["3.3.1", "Issue evaluation"],
      ["3.3.2", "Fieldwork"],
    ],
  }],
};

export const EXAM_SPECIFICATION_OUTLINES: readonly SpecificationOutline[] = [
  AQA_GCSE_BIOLOGY,
  AQA_GCSE_CHEMISTRY,
  AQA_GCSE_PHYSICS,
  AQA_GCSE_COMBINED_SCIENCE_TRILOGY,
  AQA_GCSE_GEOGRAPHY,
];
