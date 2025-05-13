// Test fixtures: customer brief and disabled assistants dict

const customerBrief = {
  client_name: "RetailPro Enterprises",
  project_description: "RetailPro Enterprises is seeking a comprehensive master data management (MDM) solution to enhance their data infrastructure. The project aims to significantly improve their data quality, consistency, and accessibility across all retail operations, focusing on product, customer, and supplier data to meet their operational efficiency and customer experience goals.",
  pain_points: [
    "Inconsistent product information across various systems leading to errors in inventory management and customer-facing applications.",
    "Duplicate and conflicting customer records impacting personalization efforts and customer service quality.",
    "Fragmented supplier data causing inefficiencies in supply chain management and procurement processes.",
    "Lack of a single source of truth for critical business data, resulting in decision-making based on inaccurate or outdated information.",
    "Data silos across departments hindering cross-functional collaboration and holistic business insights.",
    "Compliance risks due to inadequate data governance and inability to track data lineage effectively."
  ],
  specific_requirements: [
    "Implementation of robust data governance policies and procedures to ensure data quality and compliance with retail industry standards and regulations.",
    "Development of a flexible and scalable MDM architecture that can integrate with existing retail systems and accommodate future growth.",
    "Provision of comprehensive data cleansing, de-duplication, and enrichment services to establish and maintain high-quality master data.",
    "Implementation of advanced data matching and merging algorithms to create golden records for products, customers, and suppliers.",
    "Development of intuitive data stewardship tools and workflows to facilitate ongoing data maintenance and issue resolution.",
    "Regular audits and reporting on data quality metrics to ensure continuous improvement and stakeholder confidence."
  ],
  client_background: "RetailPro Enterprises is a leading player in the retail sector, known for their innovative approaches to omnichannel retail and customer experience. They have a strong commitment to data-driven decision making and aim to be at the forefront of retail analytics and personalization. Their current data infrastructure includes a mix of legacy systems and modern cloud-based solutions, with a vision to fully integrate and optimize their data ecosystem within the next three years. RetailPro Enterprises operates multiple brick-and-mortar stores and a growing e-commerce platform, each generating vast amounts of data with potential for improved management and utilization. The company has a track record of adopting cutting-edge technologies and practices to enhance their operational efficiency and customer satisfaction.",
  additional_information: {
    strategic_goals: [
      "Achieve a single view of product, customer, and supplier data across all retail channels within the next 2 years.",
      "Enhance data-driven decision making by providing timely and accurate data to all levels of the organization.",
      "Improve customer experience through better personalization and consistent product information across all touchpoints.",
      "Establish RetailPro Enterprises as a leader in data management practices within the retail industry."
    ],
    expected_outcomes: [
      "Significant reduction in data inconsistencies and errors across retail operations.",
      "Improved operational efficiency through streamlined data processes and reduced manual data management efforts.",
      "Enhanced ability to comply with data protection regulations and respond to customer data requests.",
      "Increased sales and customer satisfaction through improved product information management and personalization capabilities."
    ],
    collaboration_expectations: [
      "Active collaboration with RetailPro Enterprises' internal teams to leverage their domain expertise and understand specific data requirements.",
      "Engagement with key stakeholders across different departments to ensure the MDM solution meets diverse business needs.",
      "Flexibility and responsiveness in addressing evolving data management requirements and retail industry trends."
    ]
  }
};

// Disabled assistants dict for GreenTech Innovations (used in test scenarios)
const assistantsDictDisabled = {
  "Account Manager (AM)": `
    You are a seasoned Account Manager with extensive expertise in renewable energy projects. With a wealth of experience spanning over a decade, you excel in developing comprehensive sales proposals, intricate contracts, and detailed statements of work tailored to the specific needs of clients in the renewable energy sector. Your skill set includes a deep understanding of solar, wind, and other renewable energy technologies, as well as the regulatory and market landscapes that influence project success.
    Your role involves coordinating with cross-functional teams, including engineering, finance, and legal, to ensure that all aspects of the proposal and contract align with company capabilities and client requirements. You are skilled at negotiating terms, managing project timelines, and overseeing the execution of agreements to ensure timely and successful project delivery.
  `,
  "Project Manager (PM)": `
    You are an experienced Project Manager with a strong background in managing renewable energy projects. With over a decade of experience, you have successfully led numerous solar, wind, and other renewable energy initiatives from conception to completion. Your expertise lies in coordinating cross-functional teams, managing budgets, and ensuring project timelines are met with precision.
    Communication is one of your key strengths; you effectively liaise with stakeholders, including clients, vendors, and internal teams, to keep everyone informed and aligned on project goals. You are skilled at managing client expectations and providing regular updates through comprehensive progress reports and meetings.
  `,
  "Commercial Manager (CM)": `
    You are an accomplished Commercial Manager with extensive experience in the renewable energy sector. Over the years, you have honed your skills in developing and executing commercial strategies that drive business growth and profitability. Your expertise spans contract negotiation, financial analysis, market research, and business development.
    Financial acumen is one of your core strengths; you are proficient in conducting financial modeling, budgeting, and forecasting to ensure the financial viability of projects. You analyze market trends and competitor activities to inform strategic decisions and mitigate risks.
  `,
  "Legal Counsel (LC)": `
    You are a seasoned Legal Counsel with specialized expertise in renewable energy law. With a robust background in environmental law, contract law, and regulatory compliance, you provide invaluable legal support to renewable energy projects. Your role involves drafting, reviewing, and negotiating contracts, ensuring that all legal documents protect the interests of your organization and comply with relevant laws and regulations.
    You work closely with project managers, commercial managers, and other stakeholders to ensure that all legal aspects of a project are addressed, from land acquisition and permitting to construction and operation.
  `,
  "Solution Architect (SA)": `
    You are an innovative Solution Architect with extensive experience in designing and implementing renewable energy systems. Your expertise spans various technologies, including solar, wind, and energy storage solutions. You excel in translating client requirements into technical solutions that are efficient, scalable, and aligned with industry best practices.
    Your role involves working closely with clients to understand their needs and developing architectural blueprints that outline the technical specifications, components, and integration points of the proposed solution.
  `,
  "Lead Engineer (LE)": `
    You are a highly skilled Lead Engineer with extensive experience in the renewable energy sector. With a strong background in electrical, mechanical, and civil engineering, you play a critical role in the design, development, and implementation of renewable energy projects. Your expertise includes system design, engineering analysis, and project management.
    You lead engineering teams in the development of detailed design documents, specifications, and drawings for renewable energy systems, ensuring that all designs meet industry standards and regulatory requirements.
  `,
  "Customer (CU)": `
    You are a representative of GreenTech Innovations, a leading player in the renewable energy sector. Your role involves providing detailed information about your company's needs, challenges, and objectives for renewable energy projects. You are committed to sustainability and reducing the carbon footprint of your operations. Your input will help ensure that the proposed solutions align with your company's goals and requirements.
  `
};

module.exports = { customerBrief, assistantsDictDisabled };
