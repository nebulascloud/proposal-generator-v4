/**
 * Default proposal structure when no template file is provided.
 */
const defaultTemplate = {
  "Front Cover": {
    "Title": "Project Name and Proposal Title",
    "Client Information": {
      "Client Name": "",
      "Company": "",
      "Contact Details": ""
    },
    "Your Information": {
      "Company Name": "",
      "Contact Details": "",
      "Logo": ""
    },
    "Date": "Submission Date"
  },
  "Executive Summary": {
    "Introduction": "A compelling opening statement addressing the client's needs.",
    "Client's Pain Points": "Demonstrate your understanding of the client's challenges.",
    "Your Solution": "How your product/service solves the client's problems.",
    "Why Choose Us?": "Highlight your unique selling propositions and competitive advantages.",
    "Call to Action": "Clear instructions on the next steps for the client."
  },
  "Problem Statement": {
    "Problem Definition": "Clearly define the client's problem.",
    "Supporting Data": "Include data or insights to substantiate the issue.",
    "Impact": "Explain the impact of the problem on the client's business."
  },
  "Proposed Solution": {
    "Solution Description": "Detailed description of your proposed solution.",
    "Implementation Steps": "Include implementation steps, technologies used, and methodologies.",
    "Unique Aspects": "Highlight any unique or innovative aspects of your solution."
  },
  "Project Deliverables": {
    "Deliverables List": "Itemized list of what you will deliver.",
    "Deliverables Description": "Detailed descriptions and benefits of each deliverable.",
    "Scope of Work": "Specify what is included and what is not."
  },
  "Project Timeline": {
    "Visual Timeline": "Visual representation (Gantt chart or timeline) of the project phases.",
    "Milestones": "Key milestones and deliverables with estimated completion dates.",
    "Client Responsibilities": "Any shared responsibilities or actions required from the client."
  },
  "Pricing": {
    "Cost Breakdown": "Transparent and detailed breakdown of costs.",
    "Pricing Options": "Different pricing options or packages (if applicable).",
    "Interactive Pricing Table": "Include an interactive pricing table if possible."
  },
  "Case Studies and Testimonials": {
    "Case Studies": "Include relevant case studies showcasing your past successes.",
    "Testimonials": "Testimonials from satisfied clients to build credibility.",
    "Additional References": "Links to detailed case studies or additional references."
  },
  "About Us": {
    "Company Overview": "Brief overview of your company.",
    "Team Introductions": "Team introductions, highlighting key personnel involved in the project.",
    "Experience and Expertise": "Your experience and expertise related to the client's industry."
  },
  "Next Steps": {
    "Proposal Summary": "Summary of the proposal.",
    "Call to Action": "Specific call to action (e.g., schedule a follow-up meeting, sign the agreement).",
    "Validity Period": "Validity period of the proposal and contact information for further inquiries."
  },
  "Appendices": {
    "Additional Information": "Additional relevant information, such as terms and conditions, technical specifications, or detailed methodologies."
  }
};

/**
 * Renders the default proposal to a markdown string.
 */
function renderDefault({ title, client, details }) {
  let output = '';
  for (const [section, fields] of Object.entries(defaultTemplate)) {
    output += `# ${section}\n`;
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'string') {
        let text = value;
        if (key === 'Title') text = title;
        output += `**${key}**: ${text}\n`;
      } else if (typeof value === 'object') {
        output += `## ${key}\n`;
        for (const [subKey, subVal] of Object.entries(value)) {
          output += `**${subKey}**: ${subVal}\n`;
        }
      }
    }
    output += '\n';
  }
  return output;
}

module.exports = { defaultTemplate, renderDefault };
