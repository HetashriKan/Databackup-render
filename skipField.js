const skippedFields = {
        "Lead": {
            "field": [
                "Pronouns",
                "GenderIdentity"
            ]
        },

        "Contact": {
            "field": [
                "ContactSource",

                // Below fields need to be researched
                "Pronouns",
                "GenderIdentity",
                "BuyerAttributes"
            ]
        }
};

module.exports = skippedFields;