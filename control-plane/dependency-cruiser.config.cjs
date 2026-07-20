/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "domain-is-pure",
      severity: "error",
      from: { path: "/domain/" },
      to: {
        path: "(^|/)(application|infrastructure|transport|app)/|node_modules|^node:",
      },
    },
    {
      name: "application-does-not-import-outward",
      severity: "error",
      from: { path: "/application/" },
      to: { path: "(^|/)(infrastructure|transport|app)/" },
    },
    {
      name: "protocol-stays-in-transport",
      severity: "error",
      from: { pathNot: "/transport/" },
      to: { path: "@eject/protocol-contract" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"] },
    reporterOptions: { dot: { collapsePattern: "node_modules/[^/]+" } },
  },
};
